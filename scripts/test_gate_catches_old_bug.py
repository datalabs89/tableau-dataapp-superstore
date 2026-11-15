"""
Prove the new XML gate actually catches the bug it was written for.

A check that has never failed is not evidence. This reconstructs the exact
malformation the earlier revision produced - a hand-written sqlproxy connection
that swallowed the datasource's closing tag - and confirms verify_package.py
rejects it. If this test passes while the bug is present, the gate is useless.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "build" / "package"
TWB = PKG / "Superstore Executive.twb"
BACKUP = ROOT / "build" / "_twb_backup.twb"

# The regex the old build_package.py used. It matches a SELF-CLOSING
# excel-direct connection and then runs on to the closing tag of the enclosing
# federated element - 29 KB of the datasource, including its own </connection>.
OLD_REGEX = re.compile(r"<connection\b[^>]*class='excel-direct'.*?</connection>", re.S)


def main() -> int:
    if not TWB.exists():
        print("FATAL: build the package first", file=sys.stderr)
        return 2

    good = TWB.read_text(encoding="utf-8")
    shutil.copy2(TWB, BACKUP)

    try:
        # 1. Confirm the gate passes on the good file.
        rc_good = run_verify()
        print(f"  good workbook   -> verify_package exit {rc_good} "
              f"({'PASS' if rc_good == 0 else 'FAIL'})")

        # 2. Reproduce the old mistake.
        m = OLD_REGEX.search(good)
        if m is None:
            print("  SKIP: the old regex no longer matches this workbook")
            return 1
        gutted = OLD_REGEX.sub(
            "<connection channel='https' class='sqlproxy' dbname='Superstore' "
            "directory='/dataserver' port='443' server='x.online.tableau.com' "
            "server-ds-friendly-name='Superstore' username=''>"
            "<relation name='sqlproxy' table='[sqlproxy]' type='table' /></connection>",
            good, count=1)
        TWB.write_text(gutted, encoding="utf-8")
        print(f"  injected the old bug: replaced {len(m.group(0)):,} chars "
              f"(the old regex over-matched by ~29 KB)")

        rc_bad = run_verify()
        print(f"  gutted workbook -> verify_package exit {rc_bad} "
              f"({'PASS (gate is broken!)' if rc_bad == 0 else 'FAIL (gate works)'})")

        if rc_bad == 0:
            print()
            print("FAILED: the gate did not catch the malformation it exists to catch.")
            return 1

    finally:
        shutil.copy2(BACKUP, TWB)
        BACKUP.unlink(missing_ok=True)

    # 3. And the restored file must pass again, so the test left no residue.
    rc_restored = run_verify()
    print(f"  restored        -> verify_package exit {rc_restored} "
          f"({'PASS' if rc_restored == 0 else 'FAIL'})")
    if rc_restored != 0:
        print("FAILED: the test did not restore the workbook")
        return 1

    print()
    print("PASS - the XML gate rejects the malformation and accepts the good file.")
    return 0


def run_verify() -> int:
    r = subprocess.run(
        [sys.executable, "-I", str(ROOT / "scripts" / "verify_package.py")],
        cwd=str(ROOT), capture_output=True, text=True)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
