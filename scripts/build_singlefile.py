"""
Build a single self-contained HTML file of the data app, for review in a browser
with no server and no sibling files.

Every stylesheet, every script, and the row data are inlined, in the same order
index.html loads them. The app code is NOT forked: it is the same source the
package ships, read from disk at build time, so the reviewable page cannot drift
from the published artifact.

The data is inlined as SV.PREVIEW_ROWS, which PreviewStore prefers over a fetch
(see store.js) - a fetch of a sibling file is not available in a single file.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dataapp"
ROWS = ROOT / "build" / "data" / "rows.json"
OUT = ROOT / "build" / "Superstore-Executive-preview.html"

LIB = (ROOT / "reference" / "dataapp-sample" / "p" / "content" / "src"
       / "tableau.extensions.1.latest.min.js")


def main() -> int:
    if not ROWS.exists():
        print("FATAL: run export_rows.py first", file=sys.stderr)
        return 2

    html = (APP / "index.html").read_text(encoding="utf-8")

    # The Extensions API library is ~285 KB and useless outside Tableau: in a
    # plain browser it defines window.tableau and initializeAsync() never
    # settles. Dropping it also makes the file honest about being the preview.
    html = re.sub(r'\s*<script src="src/tableau\.extensions\.1\.latest\.min\.js"></script>', "", html)

    # Inline the stylesheet.
    css = (APP / "src" / "styles.css").read_text(encoding="utf-8")
    html = html.replace(
        '<link rel="stylesheet" href="src/styles.css" />',
        "<style>\n" + css + "\n</style>")

    # Inline the row bundle before the app scripts, as a plain assignment.
    rows = ROWS.read_text(encoding="utf-8")
    data_script = ("<script>\n"
                   "/* Superstore rows, inlined for this single-file preview. */\n"
                   "window.SV = window.SV || {};\n"
                   "window.SV.PREVIEW_ROWS = " + rows + ";\n"
                   "</script>")

    # Inline each script, preserving the order index.html declares.
    def inline(m: re.Match) -> str:
        src = m.group(1)
        path = APP / src
        if not path.exists():
            raise SystemExit(f"FATAL: {src} referenced by index.html is missing")
        js = path.read_text(encoding="utf-8")
        # A literal </script> inside a string would close the tag early.
        js = js.replace("</script>", "<\\/script>")
        return "<script>\n/* ===== " + src + " ===== */\n" + js + "\n</script>"

    html = re.sub(r'<script src="(src/[^"]+\.js)"></script>', inline, html)

    # The preview marker must land AFTER boot.js so SV exists, but BEFORE
    # store.js runs. It has to be its own <script> element, so the insertion
    # point is the OPENING tag of store.js's block - inserting before the inner
    # comment would nest a <script> inside one already open and the inner
    # </script> would close it early.
    marker = "<script>\n/* ===== src/store.js ===== */"
    if marker not in html:
        raise SystemExit("FATAL: could not find the store.js block to place data before")
    html = html.replace(marker, data_script + "\n" + marker, 1)

    html = html.replace("<title>Superstore Executive</title>",
                        "<title>Superstore Executive</title>")

    OUT.write_text(html, encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"OK  single-file preview  {OUT}")
    print(f"    {kb:,.0f} KB, no sibling files, no server needed")
    for needle, label in [("SV.PREVIEW_ROWS", "row data inlined"),
                          ("superstore-theme", "theme preference"),
                          ("queryAsync", "runtime query path present")]:
        print(f"    {'yes' if needle in html else 'NO ':>3}  {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
