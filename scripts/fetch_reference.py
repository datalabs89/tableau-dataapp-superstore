"""
Fetch the third-party reference files this project builds against.

These are Tableau's own artifacts (the official Superstore Data App sample and
the Extensions API beta library). They are downloaded on demand rather than
committed here: they are not this project's work to redistribute, they carry
Tableau's copyright, and the library alone is 285 KB of minified bundler output
that would churn the diff on every upstream change.

Run once after cloning:

    python scripts/fetch_reference.py

Everything lands in reference/, which is gitignored.
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "reference" / "dataapp-sample"

BASE = ("https://raw.githubusercontent.com/tableau/extensions-api/main/"
        "Samples/DataApp/Tableau%20Superstore%20Data%20App")
PKG = "Packages/com.tableau.mcp.tableau-superstore-data-app"

# dest path -> source URL. Only the files this project actually reads.
FILES = {
    "sample.twb": f"{BASE}/Tableau%20Superstore%20Data%20App.twb",
    f"p/manifest.json": f"{BASE}/{PKG}/manifest.json",
    f"p/extensions/data-app.trex": f"{BASE}/{PKG}/extensions/data-app.trex",
    f"p/content/index.html": f"{BASE}/{PKG}/content/index.html",
    f"p/content/src/boot.js": f"{BASE}/{PKG}/content/src/boot.js",
    f"p/content/src/lib/vds.js": f"{BASE}/{PKG}/content/src/lib/vds.js",
    f"p/content/src/lib/constants.js": f"{BASE}/{PKG}/content/src/lib/constants.js",
    f"p/content/src/tableau.extensions.1.latest.min.js":
        f"{BASE}/{PKG}/content/src/tableau.extensions.1.latest.min.js",
}

# The moment the Extensions API is fetched as a bare load-bearing dependency.
LIB_NAME = "tableau.extensions.1.latest.min.js"
LIB_PATH = DEST / "p" / "content" / "src" / LIB_NAME


def main() -> int:
    verb = "--force" in sys.argv
    print(f"reference -> {DEST}")

    ok, skipped, failed = 0, 0, []
    for rel, url in FILES.items():
        dest = DEST / rel
        if dest.exists() and not verb:
            skipped += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                data = r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            failed.append((rel, str(e)))
            continue
        dest.write_bytes(data)
        ok += 1
        print(f"  fetched  {rel}  ({len(data) / 1024:,.0f} KB)")

    print()
    if skipped:
        print(f"  {skipped} already present (use --force to refetch)")
    for rel, err in failed:
        print(f"  FAILED   {rel}: {err}")

    if not LIB_PATH.exists():
        print()
        print("The Extensions API library is still missing, and the package cannot be")
        print("built without it (it is what provides queryAsync/readMetadata).")
        return 1

    print()
    print("OK - reference files ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
