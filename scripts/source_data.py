"""
Locate the Superstore source workbook.

The path is not hardcoded: on a cloned repo the file is wherever the person
kept it, and baking one machine's folder into the scripts would make them
unrunnable anywhere else (and leak a local directory layout into the repo).

Resolution order:
  1. --src <path> on the command line
  2. the SUPERSTORE_XLSX environment variable
  3. ./data/Sample - Superstore.xlsx inside this project
  4. a short list of common user-folder locations
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILENAME = "Sample - Superstore.xlsx"

CANDIDATES = [
    ROOT / "data" / FILENAME,
    Path.home() / "Documents" / "Data" / FILENAME,
    Path.home() / "Desktop" / "Data" / FILENAME,
    Path.home() / "Downloads" / FILENAME,
]


def find_source(argv: list[str] | None = None) -> Path:
    argv = argv if argv is not None else sys.argv[1:]

    if "--src" in argv:
        i = argv.index("--src")
        if i + 1 >= len(argv):
            raise SystemExit("--src needs a path")
        p = Path(argv[i + 1]).expanduser()
        if not p.exists():
            raise SystemExit(f"FATAL: --src not found: {p}")
        return p

    env = os.environ.get("SUPERSTORE_XLSX")
    if env:
        p = Path(env).expanduser()
        if p.exists():
            return p
        raise SystemExit(f"FATAL: SUPERSTORE_XLSX points at a missing file: {p}")

    # A repo-local copy, then the usual places a person keeps a downloaded
    # workbook. First hit wins.
    for p in CANDIDATES:
        if p.exists():
            return p

    found = _search_limited()
    if found:
        return found

    raise SystemExit(
        "FATAL: could not find " + FILENAME + ".\n"
        "  Pass it explicitly:      python <script> --src \"<path>\"\n"
        "  Or set the environment:  SUPERSTORE_XLSX=<path>\n"
        "  Or copy it to:           " + str(ROOT / "data" / FILENAME) + "\n"
        "  Searched: " + "\n            ".join(str(p) for p in CANDIDATES)
    )


def _search_limited() -> Path | None:
    """A shallow search of the user's folder, so a relocated copy still works."""
    home = Path.home()
    try:
        for base in (home / "Documents", home / "Desktop", home / "Downloads"):
            if not base.is_dir():
                continue
            for p in base.rglob(FILENAME):
                # Skip anything inside a build tree or another clone.
                if any(part in {"build", "node_modules", ".git"} for part in p.parts):
                    continue
                return p
    except (OSError, PermissionError):
        return None
    return None
