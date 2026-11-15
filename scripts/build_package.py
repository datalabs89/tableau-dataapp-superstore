"""
Assemble the Tableau data app package and the .twbx.

Layout produced (per the Extensions API "Data App Details" spec):

  build/package/
    Superstore Executive.twb
    Packages/com.example.superstore-executive/
      manifest.json
      extensions/data-app.trex
      content/index.html
      content/src/*.js, styles.css, tableau.extensions.1.latest.min.js

  build/Superstore Executive.twbx   <- ZIP of the above, .twb + Packages/ at root

The .twb is written from the template with the values this app needs: the
extension instance, its encodings, the referenced-extension copy, and the
datasource connection block. Nothing is copied from a workbook blindly - every
identifier below is asserted to match across the manifest, the .trex and the
.twb, because a mismatch there is what makes an extension pane load blank.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

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
DS_NAME = "federated.superstore0executive0sample"
DS_CAPTION = "Superstore"

# The library the official sample ships with: 1.19.0-pre.10, the only build on
# hand that exposes queryAsync() and readMetadata(). The SDK clone in lib/ is
# 1.17.0 and does NOT have them.
LIB_SRC = (ROOT / "reference" / "dataapp-sample" / "p"
           / "content" / "src" / "tableau.extensions.1.latest.min.js")


def main() -> int:
    if not TEMPLATE.exists():
        print(f"FATAL: twb template missing: {TEMPLATE}", file=sys.stderr)
        print("       run:  python scripts/fetch_reference.py", file=sys.stderr)
        return 2
    if not LIB_SRC.exists():
        print(f"FATAL: Extensions API beta library missing: {LIB_SRC}", file=sys.stderr)
        print("       run:  python scripts/fetch_reference.py", file=sys.stderr)
        return 2

    # The library is load-bearing: without queryAsync() the published app would
    # build fine and fail at runtime. Check the contract here rather than
    # discovering it in Tableau.
    lib_text = LIB_SRC.read_text(encoding="utf-8", errors="replace")
    for api in ("queryAsync", "readMetadata"):
        if api not in lib_text:
            print(f"FATAL: the Extensions API library at {LIB_SRC.name} has no {api}().",
                  file=sys.stderr)
            print("       Data apps need 1.19.x; the SDK's lib/ copy is 1.17 and lacks it.",
                  file=sys.stderr)
            return 2

    if PKG.exists():
        shutil.rmtree(PKG)
    pkgdir = PKG / "Packages" / PKG_ID
    (pkgdir / "extensions").mkdir(parents=True)
    (pkgdir / "content" / "src").mkdir(parents=True)

    # ---- content ---------------------------------------------------------
    shutil.copy2(APP / "index.html", pkgdir / "content" / "index.html")
    for f in sorted((APP / "src").glob("*.js")):
        shutil.copy2(f, pkgdir / "content" / "src" / f.name)
    shutil.copy2(APP / "src" / "styles.css", pkgdir / "content" / "src" / "styles.css")
    shutil.copy2(LIB_SRC, pkgdir / "content" / "src" / "tableau.extensions.1.latest.min.js")

    # ---- manifest.json ---------------------------------------------------
    manifest = {
        "id": PKG_ID,
        "version": EXT_VERSION,
        "name": APP_NAME,
        "author": "Built from the local Superstore dataset",
        "requestedOrigins": "",
    }
    (pkgdir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # ---- extension manifest (.trex) --------------------------------------
    icon = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
            "YAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
    trex = f"""<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <worksheet-extension id="{PKG_ID}" extension-version="{EXT_VERSION}">
    <default-locale>en_US</default-locale>
    <name resource-id="name" />
    <description>Superstore executive overview. Queries its published datasource at runtime through the Extensions API.</description>
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
"""
    (pkgdir / "extensions" / "data-app.trex").write_text(trex, encoding="utf-8")

    # ---- workbook --------------------------------------------------------
    make_workbook(PKG / WORKBOOK)

    # ---- package the .twbx ----------------------------------------------
    twbx = OUT / f"{APP_NAME}.twbx"
    if twbx.exists():
        twbx.unlink()
    with zipfile.ZipFile(twbx, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(PKG / WORKBOOK, WORKBOOK)
        for f in sorted(pkgdir.rglob("*")):
            if f.is_file():
                z.write(f, str(f.relative_to(PKG)).replace("\\", "/"))

    # ---- report ----------------------------------------------------------
    files = [p for p in pkgdir.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    print(f"OK  package  {PKG}")
    print(f"    files    {len(files)}  ({total / 1024:,.0f} KB)")
    print(f"    workbook {WORKBOOK}")
    print(f"    twbx     {twbx.name}  ({twbx.stat().st_size / 1024:,.0f} KB)")
    print()
    print("    identity check (must match across manifest / .trex / .twb):")
    for label, value in [("package id", PKG_ID), ("extension version", EXT_VERSION),
                         ("extension name", APP_NAME), ("instance id", INSTANCE_ID)]:
        print(f"      {label:<18} {value}")
    return 0


def make_workbook(dest: Path) -> None:
    """Writes the .twb: template with the data app's extension instance installed."""
    src = TEMPLATE.read_text(encoding="utf-8")

    # The template already carries an extension instance for its own app. Retarget
    # every app-specific identifier rather than editing XML by hand.
    src = src.replace("com.tableau.mcp.tableau-superstore-data-app", PKG_ID)
    src = src.replace("Tableau Superstore Data App", APP_NAME)
    src = src.replace("A1B2C3D4E5F60718293A4B5C6D7E8F90", INSTANCE_ID)

    # The template reads its data through a relative Excel path; this app points
    # at a published datasource instead, so the connection has to change.
    if 'federated.1superstore0studio0sample0' not in src:
        raise SystemExit("FATAL: template datasource name not found - template changed?")

    src = retarget_datasource(src)

    # Assert the three identifiers really are consistent before writing.
    for needle, label in [(PKG_ID, "package id"),
                          (f"extension-version='{EXT_VERSION}'", "extension version"),
                          (INSTANCE_ID, "instance id"),
                          (APP_NAME, "app name")]:
        if needle not in src:
            raise SystemExit(f"FATAL: {label} missing from the generated .twb")

    dest.write_text(src, encoding="utf-8")


def retarget_datasource(src: str) -> str:
    """
    Points the workbook at the published datasource `Superstore`.

    The template ships an excel-direct connection to a bundled .xls. A data app
    that must query a site datasource at runtime needs a sqlproxy connection
    with a repository-location, so the whole connection element is replaced.
    """
    old_name = "federated.1superstore0studio0sample0"

    # Replace the connection element inside the datasource block.
    conn_re = re.compile(
        r"<connection\b[^>]*class='excel-direct'.*?</connection>", re.S)
    new_conn = (
        f"<connection channel='https' class='sqlproxy' dbname='{DS_CAPTION}' "
        f"directory='/dataserver' port='443' server='REPLACE_WITH_YOUR_POD.online.tableau.com' "
        f"server-ds-friendly-name='{DS_CAPTION}' username=''>"
        f"<relation name='sqlproxy' table='[sqlproxy]' type='table' /></connection>"
    )
    src, n = conn_re.subn(new_conn, src, count=1)
    if n != 1:
        raise SystemExit("FATAL: could not locate the excel-direct connection to retarget")

    # Rename the workbook-local datasource key everywhere it is referenced, and
    # add the repository-location that identifies the published source.
    src = src.replace(old_name, DS_NAME)
    src = src.replace(
        f"<datasource caption='Sample - Superstore' inline='true' name='{DS_NAME}' version='18.1'>",
        f"<datasource caption='{DS_CAPTION}' inline='true' name='{DS_NAME}' version='18.1'>\n"
        f"    <repository-location id='{DS_CAPTION}' "
        f"path='/t/REPLACE_WITH_YOUR_SITE/datasources' site='REPLACE_WITH_YOUR_SITE' />")
    src = src.replace(f"caption='Sample - Superstore'", f"caption='{DS_CAPTION}'")
    return src


if __name__ == "__main__":
    raise SystemExit(main())
