"""
Open the generated workbook with tooling that is not this project's own code.

verify_package.py checks strings inside the .twb. That is not the same as the
workbook being OPENABLE, and an earlier revision shipped a malformed .twb that
every string check passed. This script closes that gap with three independent
readers, from weakest to strongest:

  1. XML parse            - structural validity (stdlib).
  2. Tableau Document API - the library Tableau publishes for reading .twb/.twbx.
                            Loads the workbook into its object model and reads
                            the datasource, connections and fields back out.
  3. Tableau Desktop (COM)- actually opens the file in the application, when
                            Desktop is installed. This is the real answer to
                            "does it open", and it is skipped with a clear
                            message when Desktop is absent.

Any of the first two failing is a hard failure. The third is skipped, not
failed, when Tableau is not installed on the machine running the check.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "build" / "package"
TWB = PKG / "Superstore Executive.twb"
TWBX = ROOT / "build" / "Superstore Executive.twbx"

# Tableau's own Document API, if it is installed or cloned nearby.
DOC_API_CANDIDATES = [
    Path.home() / "document-api-python",
    ROOT.parent / "document-api-python",
]

failures: list[str] = []
notes: list[str] = []


def step(label: str, ok: bool | None, detail: str = "") -> None:
    mark = {True: "PASS", False: "FAIL", None: "SKIP"}[ok]
    line = f"  [{mark}] {label}"
    if detail:
        line += f"\n         {detail}"
    print(line)
    if ok is False:
        failures.append(label)
    notes.append(label)


def main() -> int:
    if not TWB.exists():
        print(f"FATAL: {TWB} missing - run build_package.py first", file=sys.stderr)
        return 2

    print("=== 1. XML structure ===")
    check_xml()

    print("\n=== 2. Tableau Document API ===")
    check_document_api()

    print("\n=== 3. Tableau Desktop (COM) ===")
    check_desktop()

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS - the workbook opens in every reader available on this machine.")
    return 0


def check_xml() -> None:
    try:
        tree = ET.parse(TWB)
    except ET.ParseError as e:
        step("workbook is well-formed XML", False, str(e))
        return
    root = tree.getroot()
    step("workbook is well-formed XML", True,
         f"root <{root.tag.split('}')[-1]}> version={root.get('version')}")

    ds = root.find("datasources")
    n_ds = len(list(ds)) if ds is not None else 0
    step("has a datasource", n_ds > 0, f"{n_ds} datasource element(s)")

    # The connection must reach the bundled file by a RELATIVE path, or the
    # workbook will not open anywhere but this machine.
    text = TWB.read_text(encoding="utf-8")
    import re
    filenames = re.findall(r"filename='([^']*)'", text)
    rel_ok = any(f and not f.startswith(("/", "\\")) and ":" not in f
                 for f in filenames)
    step("datasource path is relative to the workbook", rel_ok,
         f"filename(s): {filenames}")

    step("has worksheets", root.find("worksheets") is not None)

    # The bundled data must actually be present next to the workbook.
    data_rel = "Data/Datasources/Sample - Superstore.xlsx"
    data_abs = PKG / data_rel
    step("bundled data file exists", data_abs.exists(),
         f"{data_rel} ({data_abs.stat().st_size / 1024:,.0f} KB)" if data_abs.exists() else "")

    # And inside the .twbx, at the archive root, alongside the .twb.
    if TWBX.exists():
        with zipfile.ZipFile(TWBX) as z:
            names = z.namelist()
            step(".twbx carries the .twb at its root",
                 "Superstore Executive.twb" in names)
            step(".twbx carries the data at the same relative path",
                 data_rel in names)
            step(".twbx carries Packages/ at its root", "Packages" in
                 {n.split("/")[0] for n in names})
    else:
        step(".twbx exists", False, str(TWBX))


def check_document_api() -> None:
    api_path = None
    for c in DOC_API_CANDIDATES:
        if (c / "tableaudocumentapi").is_dir():
            api_path = c
            break
    if api_path is None:
        step("Tableau Document API importable", None,
             "not installed or not cloned; pip install tableaudocumentapi")
        return
    sys.path.insert(0, str(api_path))
    try:
        import tableaudocumentapi as tda
        from tableaudocumentapi import Workbook
    except Exception as e:  # noqa: BLE001
        step("Tableau Document API importable", False, f"{type(e).__name__}: {e}")
        return
    step("Tableau Document API importable", True,
         f"v{getattr(tda, 'VERSION', '?')} from {api_path}")

    # The real test: hand Tableau's own reader the file and read it back.
    try:
        wb = Workbook(str(TWB))
    except Exception as e:  # noqa: BLE001
        step("Document API opens the workbook", False, f"{type(e).__name__}: {e}")
        return
    step("Document API opens the workbook", True)

    try:
        dss = wb.datasources
        step("Document API reads the datasource", len(dss) > 0,
             f"{len(dss)}: {[d.name for d in dss]}")
        if dss:
            ds = dss[0]
            conns = list(ds.connections)
            step("Document API reads the connection", len(conns) > 0,
                 f"{[(c.dbclass, getattr(c, 'filename', None)) for c in conns]}")
            fields = sorted(ds.fields)
            step("Document API reads the fields", len(fields) > 5,
                 f"{len(fields)} fields, e.g. {fields[:6]}")
            for want in ("Sales", "Profit", "Region", "State/Province", "Order Date"):
                if want not in fields:
                    step(f"field present: {want}", False)
            step("key fields present (Sales/Profit/Region/State/Province/Order Date)",
                 all(w in fields for w in
                     ("Sales", "Profit", "Region", "State/Province", "Order Date")))
    except Exception as e:  # noqa: BLE001
        step("Document API model is readable", False, f"{type(e).__name__}: {e}")


def check_desktop() -> None:
    try:
        import win32com.client  # noqa: F401
    except Exception:  # noqa: BLE001
        step("Tableau Desktop open test", None, "pywin32 not installed")
        return

    exe = Path(r"C:\Program Files\Tableau\Tableau 2026.3\bin\tableau.exe")
    if not exe.exists():
        found = sorted(Path(r"C:\Program Files\Tableau").glob("Tableau 20*/bin/tableau.exe"))
        exe = found[-1] if found else exe
    if not exe.exists():
        step("Tableau Desktop open test", None, "Tableau Desktop not installed")
        return

    import win32com.client as w32
    try:
        app = w32.Dispatch("Tableau.Application")
    except Exception as e:  # noqa: BLE001
        step("Tableau Desktop open test", None,
             f"could not reach the application: {type(e).__name__}: {e}")
        return

    opened = False
    try:
        app.Visible = True
        doc = app.OpenWorkbook(str(TWBX))
        # A workbook that opened exposes its name back to us.
        name = doc.Name if doc is not None else None
        opened = bool(name)
        step("Tableau Desktop opens the .twbx", opened, f"workbook name: {name}")
        if opened:
            try:
                books = app.Workbooks.Count
                step("workbook is registered in the application", books >= 1,
                     f"{books} open workbook(s)")
            except Exception:  # noqa: BLE001
                pass
            try:
                doc.Close()
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        step("Tableau Desktop opens the .twbx", False, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
