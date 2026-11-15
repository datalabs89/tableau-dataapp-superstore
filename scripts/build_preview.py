"""
Assemble the offline preview directory.

IMPORTANT: this directory is NOT the shipped artifact. The published package
deliberately contains no data - a viewer must never be shown a stale bundled
copy. The preview exists only so the app can be reviewed in a browser before
it is published; here the same app runs against bundled rows so the layout,
interactions and arithmetic can be checked.

  build/preview/
    index.html, src/...        <- copied from dataapp/
    data/rows.json             <- copied from build/data/  (preview only)
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dataapp"
DATA = ROOT / "build" / "data"
OUT = ROOT / "build" / "preview"
LIB_SRC = (ROOT / "reference" / "dataapp-sample" / "p"
           / "content" / "src" / "tableau.extensions.1.latest.min.js")


def main() -> int:
    if not (DATA / "rows.json").exists():
        print("FATAL: run export_rows.py first (build/data/rows.json missing)",
              file=sys.stderr)
        return 2
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    shutil.copy2(APP / "index.html", OUT / "index.html")
    shutil.copytree(APP / "src", OUT / "src")
    # The Extensions API library is supplied at build time (it is not authored
    # here), so the preview needs it copied in exactly as the package build does.
    shutil.copy2(LIB_SRC, OUT / "src" / LIB_SRC.name)
    (OUT / "data").mkdir()
    shutil.copy2(DATA / "rows.json", OUT / "data" / "rows.json")

    js = len(list((OUT / "src").glob("*.js")))
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"OK  preview  {OUT}")
    print(f"    {js} scripts, {size / 1024:,.0f} KB total (incl. {rows_kb(OUT):,.0f} KB of data)")
    return 0


def rows_kb(out: Path) -> float:
    return (out / "data" / "rows.json").stat().st_size / 1024


if __name__ == "__main__":
    raise SystemExit(main())
