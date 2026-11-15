"""
Build everything, in order, stopping at the first failure.

One entry point so the README can be honest: a fresh clone runs this and gets
the same artifacts the verification scripts were written against. Each step is
a separate process, so a failure in one aborts the chain rather than leaving a
half-built tree that later steps read as valid.

    python scripts/build_all.py                 # build
    python scripts/build_all.py --verify        # build, then run all checks
    python scripts/build_all.py --src "<path>"  # point at the workbook
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"

BUILD = [
    ("export_data.py", "aggregates + expectations", True),
    ("export_rows.py", "row-level bundle for the preview", True),
    ("build_package.py", "package + .twbx", False),
    ("build_preview.py", "preview directory", False),
    ("build_singlefile.py", "single-file preview", False),
]

VERIFY = [
    ("verify_package.py", "conformance to the packaging spec", False),
    ("verify_opens.py", "workbook opens in Tableau's own readers", False),
    # Reads the expectations file the build wrote, not the workbook itself.
    ("verify_render.py", "rendered figures vs independent recomputation", False),
    ("verify_aggregation.py", "aggregation vs pandas across 9 slices", True),
]


def run(script: str, label: str, passthrough: list[str]) -> bool:
    print(f"\n=== {script}  —  {label} " + "=" * max(0, 30 - len(script)))
    cmd = [sys.executable, "-I", str(SCRIPTS / script)] + passthrough
    r = subprocess.run(cmd, cwd=str(ROOT))
    ok = r.returncode == 0
    if not ok:
        print(f"\nFAILED: {script} exited {r.returncode}", file=sys.stderr)
    return ok


def main() -> int:
    argv = sys.argv[1:]
    do_verify = "--verify" in argv

    # --src is consumed by source_data.py in the child processes, so it is
    # forwarded rather than interpreted here - but only to the steps that read
    # the workbook, since the rest would reject an argument they don't take.
    passthrough: list[str] = []
    if "--src" in argv:
        i = argv.index("--src")
        if i + 1 >= len(argv):
            print("--src needs a path", file=sys.stderr)
            return 2
        passthrough = ["--src", argv[i + 1]]

    # The reference files are not committed; make the failure actionable
    # before a build step reports a confusing missing-file error.
    if not (ROOT / "reference" / "dataapp-sample" / "sample.twb").exists():
        print("Reference files are missing. Fetching them first...")
        if not run("fetch_reference.py", "Tableau's sample + the beta API library", []):
            return 1

    for script, label, takes_src in BUILD:
        if not run(script, label, passthrough if takes_src else []):
            return 1

    print("\n" + "-" * 60)
    print("BUILD OK")
    for p in sorted((ROOT / "build").glob("*")):
        if p.is_file():
            print(f"  {p.stat().st_size / 1024:>8,.0f} KB  {p.name}")
    print("                build/package/  build/preview/  build/shots/")

    if do_verify:
        for script, label, takes_src in VERIFY:
            if not run(script, label, passthrough if takes_src else []):
                print("\nVERIFICATION FAILED", file=sys.stderr)
                return 1
        print("\n" + "-" * 60)
        print("ALL CHECKS PASS")

    return 0


if __name__ == "__main__":
    sys.exit(main())
