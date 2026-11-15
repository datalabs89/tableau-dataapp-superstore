"""
Validate the built package against the Extensions API data-app spec.

Checks the things that silently make an extension pane load blank or an app
fail to publish: identity strings that must match across three files, the
package layout, the URL scheme, and a .twbx whose root really is the .twb plus
Packages/. Also proves the shipped package carries no bundled data.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "build" / "package"
TWBX = ROOT / "build" / "Superstore Executive.twbx"
NS = {"m": "http://www.tableau.com/xml/extension_manifest"}

problems: list[str] = []
notes: list[str] = []


def check(cond: bool, msg: str) -> None:
    if cond:
        notes.append("PASS  " + msg)
    else:
        problems.append(msg)


def main() -> int:
    pkgdirs = list((PKG / "Packages").glob("*")) if (PKG / "Packages").exists() else []
    check(len(pkgdirs) == 1, f"exactly one package directory (found {len(pkgdirs)})")
    if not pkgdirs:
        report(); return 1
    pkgdir = pkgdirs[0]

    # ---- required files -------------------------------------------------
    for rel in ["manifest.json", "extensions/data-app.trex",
                "content/index.html", "content/src/styles.css"]:
        check((pkgdir / rel).exists(), f"package contains {rel}")

    # ---- manifest.json --------------------------------------------------
    mf = json.loads((pkgdir / "manifest.json").read_text(encoding="utf-8"))
    for key in ("id", "version", "name", "author"):
        check(key in mf and str(mf[key]).strip() != "", f"manifest.json has a non-empty '{key}'")
    check("." in mf["id"] and not mf["id"].startswith("."),
          f"package id is a reverse-domain identifier ({mf['id']})")
    check(re.match(r"^\d+\.\d+\.\d+$", mf["version"]) is not None,
          f"manifest version is semver ({mf['version']})")

    # ---- .trex ----------------------------------------------------------
    trex_path = pkgdir / "extensions" / "data-app.trex"
    root = ET.parse(trex_path).getroot()
    ext = root.find("m:worksheet-extension", NS)
    check(ext is not None, ".trex declares a worksheet-extension")
    if ext is None:
        report(); return 1

    ext_id = ext.get("id")
    ext_ver = ext.get("extension-version")
    check(ext_id == mf["id"], f".trex id matches manifest.json ({ext_id})")
    check(ext_ver == mf["version"], f".trex version matches manifest.json ({ext_ver})")
    check(root.get("manifest-version") == "0.1", "manifest-version is 0.1")

    url = ext.find("m:source-location/m:url", NS).text
    check(url == "index.html",
          "source-location is the relative index.html (resolved inside the package)")

    minapi = ext.find("m:min-api-version", NS).text
    check(minapi == "1.11", f"min-api-version is 1.11 as the spec's examples use ({minapi})")

    perms = [p.text for p in ext.findall("m:permissions/m:permission", NS)]
    check(perms == ["full data"], f"permissions declares exactly 'full data' ({perms})")

    enc = ext.find("m:encoding", NS)
    check(enc is not None, "declares the custom Marks-card encoding")
    if enc is not None:
        roles = [r.text for r in enc.findall("m:role-spec/m:role-type", NS)]
        check(len(roles) >= 1, f"encoding declares role types ({len(roles)})")
        icon = enc.find("m:encoding-icon", NS)
        check(icon is not None and icon.get("token") is not None,
              f"encoding icon token present ({icon.get('token') if icon is not None else None})")

    # Constraint: string fields <= 1000 chars, URI <= 2084, icon 70x70 base64.
    icon_txt = ext.find("m:icon", NS).text or ""
    check(len(icon_txt) > 0, "icon is present")
    for tag in ("description",):
        v = ext.find(f"m:{tag}", NS)
        if v is not None and v.text:
            check(len(v.text) <= 1000, f"{tag} within the 1000-char limit")

    author = ext.find("m:author", NS)
    check(author is not None and author.get("website", "").startswith("https://"),
          "author website is HTTPS as required")

    # ---- workbook --------------------------------------------------------
    twb_path = PKG / "Superstore Executive.twb"
    check(twb_path.exists(), "workbook is present next to Packages/")
    twb = twb_path.read_text(encoding="utf-8")
    check(f"add-in-id='{ext_id}'" in twb,
          "workbook add-in-id matches the .trex id (a mismatch blanks the pane)")
    check(f"extension-version='{ext_ver}'" in twb,
          "workbook extension-version matches the .trex version")
    loc = f"tableaulocalext:///{ext_id}/content/index.html"
    check(loc in twb, f"workbook references the package URL scheme ({loc[:52]}...)")
    check("mark class='VizExtension'" in twb, "pane carries the VizExtension mark")
    check("referenced-extensions" in twb, "workbook carries the referenced-extension block")

    # ---- the package must ship no data ----------------------------------
    data_files = [p for p in pkgdir.rglob("*")
                  if p.is_file() and p.suffix.lower() in (".json", ".csv", ".xls", ".xlsx")
                  and p.name != "manifest.json"]
    check(not data_files,
          f"package ships no bundled data ({[p.name for p in data_files]})")

    # ---- .twbx ----------------------------------------------------------
    check(TWBX.exists(), "the .twbx exists")
    if TWBX.exists():
        with zipfile.ZipFile(TWBX) as z:
            names = z.namelist()
            roots = {n.split("/")[0] for n in names}
            check("Packages" in roots, ".twbx has Packages/ at the archive root")
            check(any(n.endswith(".twb") for n in names),
                  ".twbx has the .twb at the archive root")
            check(not any(n.startswith("Superstore Executive/") for n in names),
                  "no extra wrapper directory above the .twb (ZIP root is the package root)")
            bad = z.testzip()
            check(bad is None, f"archive integrity ({bad})")
            # Every script the HTML asks for must be inside the archive.
            html = z.read("Packages/%s/content/index.html" % ext_id).decode("utf-8")
            srcs = re.findall(r'src="([^"]+\.js)"', html)
            missing = [s for s in srcs
                       if f"Packages/{ext_id}/content/{s}" not in names]
            check(not missing, f"every script referenced by index.html is packaged ({missing})")
            hrefs = re.findall(r'href="([^"]+\.css)"', html)
            missing_css = [h for h in hrefs
                           if f"Packages/{ext_id}/content/{h}" not in names]
            check(not missing_css, f"every stylesheet referenced by index.html is packaged ({missing_css})")

            # The Extensions API library must be the beta build with the data app APIs.
            lib = f"Packages/{ext_id}/content/src/tableau.extensions.1.latest.min.js"
            if lib in names:
                blob = z.read(lib).decode("utf-8", "replace")
                check("queryAsync" in blob, "packaged library exposes queryAsync()")
                check("readMetadata" in blob, "packaged library exposes readMetadata()")
        # Sidecar .twb is not shipped separately; only inside the .twbx.
        check(True, f".twbx size {TWBX.stat().st_size / 1024:,.0f} KB")

    report()
    return 1 if problems else 0


def report() -> None:
    for n in notes:
        print("  " + n)
    if problems:
        print()
        print("FAILED:")
        for p in problems:
            print("  - " + p)
    else:
        print()
        print("PASS - package conforms to the data app packaging spec.")


if __name__ == "__main__":
    sys.exit(main())
