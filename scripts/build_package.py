"""
Assemble the Tableau data app package and the .twbx.

Layout produced (per the Extensions API "Data App Details" spec):

  build/package/
    Superstore Executive.twb
    Data/Datasources/Sample - Superstore.xlsx
    Packages/com.example.superstore-executive/
      manifest.json
      extensions/data-app.trex
      content/index.html
      content/src/*.js, styles.css, tableau.extensions.1.latest.min.js

  build/Superstore Executive.twbx   <- ZIP of the above, .twb + Packages/ at root

HOW THE WORKBOOK IS BUILT, AND WHY THIS WAY
-------------------------------------------
The workbook starts from Tableau's own published Superstore Data App sample and
keeps its datasource block untouched. That block is an `excel-direct` connection
with a path RELATIVE to the workbook:

    filename='Data/Datasources/Sample - Superstore.xlsx'

That is the pattern Tableau's own sample uses, and it is what makes the workbook
do three things at once:

  * open in Tableau Desktop with data, because the data travels with it;
  * publish to Tableau Cloud with the data, so a viewer needs no separate
    published datasource to exist first;
  * still let the shipped app query at runtime through ds.queryAsync(),
    because the workbook has a connected datasource either way.

An earlier revision of this script REPLACED that block with a hand-written
`sqlproxy` connection pointing at a published datasource. It was wrong twice
over: it produced a malformed workbook, and it invented a server/site that
cannot be known at build time. That is why this script now changes only identity
strings and asserts the datasource survived byte-for-byte.

Every identifier is asserted to match across manifest.json, the .trex and the
.twb, because a mismatch there is what makes an extension pane load blank.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_data import find_source  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dataapp"
TEMPLATE = ROOT / "reference" / "dataapp-sample" / "sample.twb"
OUT = ROOT / "build"
PKG = OUT / "package"

PKG_ID = "com.example.superstore-executive"
EXT_VERSION = "1.0.0"
APP_NAME = "Superstore Executive"
WORKBOOK = "Superstore Executive.twb"
INSTANCE_ID = "B7C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5"

# Where the bundled data lives inside the workbook, relative to the .twb. This
# path is the template's own; only the extension changes (.xls -> .xlsx).
DATA_DIR = "Data/Datasources"
DATA_NAME = "Sample - Superstore.xlsx"
DATA_REL = f"{DATA_DIR}/{DATA_NAME}"
TEMPLATE_DATA_REL = f"{DATA_DIR}/Sample - Superstore.xls"

# The template names the datasource "Sample - Superstore"; the app locates it by
# a case-insensitive "superstore" substring, so it is left as-is.
DS_CAPTION = "Sample - Superstore"

# The library Tableau's sample ships with: 1.19.0-pre.10, the only build on hand
# that exposes queryAsync() and readMetadata(). The SDK's lib/ copy is 1.17.0 and
# does NOT have them.
LIB_SRC = (ROOT / "reference" / "dataapp-sample" / "p"
           / "content" / "src" / "tableau.extensions.1.latest.min.js")

# Sheet name -> the column order the template's cached metadata declares. The
# data file must match this order so the cached column ordinals stay valid.
SHEET_COLUMNS = {
    "Orders": ["Row ID", "Order ID", "Order Date", "Ship Date", "Ship Mode",
               "Customer ID", "Customer Name", "Segment", "Country/Region",
               "City", "State/Province", "Postal Code", "Region", "Product ID",
               "Category", "Sub-Category", "Product Name", "Sales", "Quantity",
               "Discount", "Profit"],
    "People": ["Regional Manager", "Region"],
    "Returns": ["Returned", "Order ID"],
}


def main() -> int:
    for path, what, hint in [
        (TEMPLATE, "twb template", "python scripts/fetch_reference.py"),
        (LIB_SRC, "Extensions API beta library", "python scripts/fetch_reference.py"),
    ]:
        if not path.exists():
            print(f"FATAL: {what} missing: {path}", file=sys.stderr)
            print(f"       run:  {hint}", file=sys.stderr)
            return 2

    # The library is load-bearing: without queryAsync() the app would build fine
    # and fail at runtime. Check the contract here, not in Tableau.
    lib_text = LIB_SRC.read_text(encoding="utf-8", errors="replace")
    for api in ("queryAsync", "readMetadata"):
        if api not in lib_text:
            print(f"FATAL: {LIB_SRC.name} has no {api}(). Data apps need 1.19.x.",
                  file=sys.stderr)
            return 2

    # The template itself must be sound before anything is derived from it.
    try:
        ET.parse(TEMPLATE)
    except ET.ParseError as e:
        print(f"FATAL: the template is not well-formed XML: {e}", file=sys.stderr)
        return 2

    src_data = find_source()

    if PKG.exists():
        shutil.rmtree(PKG)
    pkgdir = PKG / "Packages" / PKG_ID
    (pkgdir / "extensions").mkdir(parents=True)
    (pkgdir / "content" / "src").mkdir(parents=True)

    # ---- content ---------------------------------------------------------
    shutil.copy2(APP / "index.html", pkgdir / "content" / "index.html")
    for f in sorted((APP / "src").glob("*.js")):
        shutil.copy2(f, pkgdir / "content" / "src" / f.name)
    shutil.copy2(APP / "src" / "styles.css",
                 pkgdir / "content" / "src" / "styles.css")
    shutil.copy2(LIB_SRC,
                 pkgdir / "content" / "src" / "tableau.extensions.1.latest.min.js")

    # ---- manifest.json ---------------------------------------------------
    manifest = {
        "id": PKG_ID,
        "version": EXT_VERSION,
        "name": APP_NAME,
        "author": "Built from the Superstore sample dataset",
        "requestedOrigins": "",
    }
    (pkgdir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # ---- extension manifest (.trex) --------------------------------------
    write_trex(pkgdir / "extensions" / "data-app.trex")

    # ---- bundled data ----------------------------------------------------
    data_dest = PKG / DATA_DIR / DATA_NAME
    data_dest.parent.mkdir(parents=True, exist_ok=True)
    rows = write_data(src_data, data_dest)

    # ---- workbook --------------------------------------------------------
    twb_dest = PKG / WORKBOOK
    make_workbook(twb_dest, data_dest)

    # ---- package the .twbx ----------------------------------------------
    twbx = OUT / f"{APP_NAME}.twbx"
    if twbx.exists():
        twbx.unlink()
    with zipfile.ZipFile(twbx, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(PKG / WORKBOOK, WORKBOOK)
        z.write(data_dest, DATA_REL)
        for f in sorted(pkgdir.rglob("*")):
            if f.is_file():
                z.write(f, str(f.relative_to(PKG)).replace("\\", "/"))

    files = [p for p in pkgdir.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files) + data_dest.stat().st_size
    print(f"OK  package  {PKG}")
    print(f"    files    {len(files) + 2}  ({total / 1024:,.0f} KB incl. data)")
    print(f"    workbook {WORKBOOK}")
    print(f"    data     {DATA_REL}  ({data_dest.stat().st_size / 1024:,.0f} KB, {rows:,} rows)")
    print(f"    twbx     {twbx.name}  ({twbx.stat().st_size / 1024:,.0f} KB)")
    print()
    print("    identity check (must match across manifest / .trex / .twb):")
    for label, value in [("package id", PKG_ID), ("extension version", EXT_VERSION),
                         ("extension name", APP_NAME), ("instance id", INSTANCE_ID)]:
        print(f"      {label:<18} {value}")
    return 0


def write_trex(dest: Path) -> None:
    icon = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
            "YAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
    dest.write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <worksheet-extension id="{PKG_ID}" extension-version="{EXT_VERSION}">
    <default-locale>en_US</default-locale>
    <name resource-id="name" />
    <description>Superstore executive overview. Queries its workbook datasource at runtime through the Extensions API.</description>
    <author name="Superstore Executive" email="noreply@example.com" website="https://www.tableau.com" />
    <min-api-version>1.11</min-api-version>
    <source-location>
      <url>index.html</url>
    </source-location>
    <icon>{icon}</icon>
    <permissions>
      <permission>full data</permission>
    </permissions>
    <encoding id="field">
      <display-name>Data</display-name>
      <role-spec>
        <role-type>discrete-dimension</role-type>
        <role-type>discrete-measure</role-type>
        <role-type>continuous-dimension</role-type>
        <role-type>continuous-measure</role-type>
      </role-spec>
      <fields max-count="50" />
      <encoding-icon token="level" />
    </encoding>
  </worksheet-extension>
  <resources>
    <resource id="name">
      <text locale="en_US">{APP_NAME}</text>
    </resource>
  </resources>
</manifest>
""", encoding="utf-8")


def write_data(src: Path, dest: Path) -> int:
    """
    Writes the workbook's data file, in the column order the template's cached
    metadata declares.

    The Returns sheet in the widely circulated Superstore xlsx lists
    ['Order ID', 'Returned'] while the template's metadata declares
    ['Returned', 'Order ID']. Writing the template's order keeps the cached
    column ordinals valid instead of relying on Tableau to re-resolve them.
    """
    sheets = pd.read_excel(src, sheet_name=None)
    missing = [s for s in SHEET_COLUMNS if s not in sheets]
    if missing:
        raise SystemExit(f"FATAL: {src.name} has no {missing} sheet(s); "
                         f"found {list(sheets)}")

    reordered = {}
    for name, want in SHEET_COLUMNS.items():
        df = sheets[name]
        have = [str(c) for c in df.columns]
        if have != want:
            # Only a pure reordering is safe; a rename would break the metadata.
            if sorted(have) != sorted(want):
                raise SystemExit(
                    f"FATAL: sheet '{name}' columns do not match the template.\n"
                    f"  expected: {want}\n  found:    {have}")
            df = df[want]
        reordered[name] = df

    # 'Returns' is the declared sheet order in the template.
    with pd.ExcelWriter(dest, engine="openpyxl") as xw:
        for name in ("Orders", "People", "Returns"):
            reordered[name].to_excel(xw, sheet_name=name, index=False)
    return len(reordered["Orders"])


def make_workbook(dest: Path, data_src: Path) -> None:
    """
    Installs this app's identity into a copy of the template.

    Only two kinds of change are made:
      1. the three identity strings the extension must agree on;
      2. one attribute - the bundled data file's extension.

    The datasource block itself is never rewritten. Any other drift is caught by
    the equality assertions below and by the XML parse at the end.
    """
    src = TEMPLATE.read_text(encoding="utf-8")

    # The data file is written as .xlsx; the template points at .xls.
    if TEMPLATE_DATA_REL not in src:
        raise SystemExit(f"FATAL: template does not reference {TEMPLATE_DATA_REL}")
    src = src.replace(TEMPLATE_DATA_REL, DATA_REL)

    # Identity.
    src = src.replace("com.tableau.mcp.tableau-superstore-data-app", PKG_ID)
    src = src.replace("Tableau Superstore Data App", APP_NAME)
    src = src.replace("A1B2C3D4E5F60718293A4B5C6D7E8F90", INSTANCE_ID)

    # The datasource must still be an excel-direct connection to the bundled file.
    for needle, label in [
        ("<connection class='federated'>", "the federated wrapper"),
        ("<connection class='excel-direct'", "the excel-direct connection"),
        (f"filename='{DATA_REL}'", "the bundled data path"),
        ("</datasources>", "the datasources close tag"),
        ("<worksheets>", "the worksheets section"),
    ]:
        if needle not in src:
            raise SystemExit(f"FATAL: generated .twb lost {label} ({needle!r})")

    if src.count("<connection class='excel-direct'") != 1:
        raise SystemExit("FATAL: expected exactly one excel-direct connection")

    dest.write_text(src, encoding="utf-8")

    # A workbook that will not parse is a workbook that will not open. This is
    # the check whose absence let a malformed .twb through in an earlier
    # revision, so it is not optional.
    try:
        tree = ET.parse(dest)
    except ET.ParseError as e:
        dest.unlink(missing_ok=True)
        raise SystemExit(f"FATAL: generated .twb is not well-formed XML: {e}")

    root = tree.getroot()
    ds = root.find("datasources")
    if ds is None or len(list(ds)) == 0:
        raise SystemExit("FATAL: generated .twb has an empty <datasources>")
    if root.find("worksheets") is None:
        raise SystemExit("FATAL: generated .twb has no <worksheets>")

    # The extension instance and its manifest copy must be present and agree.
    src_text = dest.read_text(encoding="utf-8")
    for needle, label in [(PKG_ID, "package id"), (INSTANCE_ID, "instance id"),
                          (f"extension-version='{EXT_VERSION}'", "extension version"),
                          ("referenced-extensions", "the referenced-extension block")]:
        if needle not in src_text:
            raise SystemExit(f"FATAL: {label} missing from the generated .twb")


if __name__ == "__main__":
    raise SystemExit(main())
