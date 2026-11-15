"""
Build Tableau's OWN sample data app into a .twbx, as a control.

Why: this project's .twbx opens in Desktop but the extension pane renders empty.
Before blaming the build, assemble Tableau's published sample the same way and
open that. If Tableau's own sample is also blank in Desktop, the blank pane is a
platform limitation (data apps are a Cloud-only beta), not something this
project's packaging got wrong.

Uses only the files fetch_reference.py already downloaded, plus a Superstore .xls
for the sample's excel-direct connection to point at.
"""

from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "reference" / "dataapp-sample"
OUT = ROOT / "build" / "control"

PKG_ID = "com.tableau.mcp.tableau-superstore-data-app"
XLS_CANDIDATES = [
    Path.home() / "Downloads" / "Sample - Superstore PJJ Duktek 2026.xls",
]


def main() -> int:
    twb = REF / "sample.twb"
    pkg_src = REF / "p"
    if not twb.exists() or not pkg_src.is_dir():
        print("FATAL: run scripts/fetch_reference.py first", file=sys.stderr)
        return 2

    if OUT.exists():
        shutil.rmtree(OUT)
    stage = OUT / "Tableau Superstore Data App"
    (stage / "Data" / "Datasources").mkdir(parents=True)

    # The workbook, verbatim - it is Tableau's own file, unmodified.
    shutil.copy2(twb, stage / "Tableau Superstore Data App.twb")

    # Its package, laid out where the .twb expects it.
    dest_pkg = stage / "Packages" / PKG_ID
    (dest_pkg / "extensions").mkdir(parents=True)
    (dest_pkg / "content").mkdir(parents=True)
    shutil.copy2(pkg_src / "manifest.json", dest_pkg / "manifest.json")
    shutil.copy2(pkg_src / "extensions" / "data-app.trex",
                 dest_pkg / "extensions" / "data-app.trex")
    for f in (pkg_src / "content").rglob("*"):
        if f.is_file():
            rel = f.relative_to(pkg_src / "content")
            (dest_pkg / "content" / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest_pkg / "content" / rel)

    # The sample's connection is excel-direct to this path. The original .xls is
    # not in the repo; any Superstore .xls with the same three sheets will do,
    # because the question here is whether the PANE renders, not the data.
    xls = next((p for p in XLS_CANDIDATES if p.exists()), None)
    if xls is not None:
        shutil.copy2(xls, stage / "Data" / "Datasources" / "Sample - Superstore.xls")
        print(f"data     : {xls.name}")
    else:
        print("data     : (none found - the datasource will error, pane test still valid)")

    twbx = OUT / "Tableau Superstore Data App.twbx"
    with zipfile.ZipFile(twbx, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(stage / "Tableau Superstore Data App.twb",
                "Tableau Superstore Data App.twb")
        for f in sorted(stage.rglob("*")):
            if f.is_file() and f.name != "Tableau Superstore Data App.twb":
                z.write(f, str(f.relative_to(stage)).replace("\\", "/"))

    print(f"OK  control .twbx  {twbx}")
    print(f"    {twbx.stat().st_size / 1024:,.0f} KB - Tableau's own sample, repacked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
