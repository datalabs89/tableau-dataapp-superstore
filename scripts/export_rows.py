"""
Export the Superstore rows as a compact columnar bundle for offline preview.

Why row-level and not a pre-built cube: the preview must recompute its
aggregates from the filtered slice, exactly as Tableau does at runtime. A cube
of pre-aggregated numbers cannot answer an arbitrary (region x date x segment)
slice, which would make the preview a mock-up rather than a rehearsal.

Encoding: every dimension becomes a small integer index into a dictionary
shipped alongside; dates become days-since-epoch-day. Order and Customer become
integer ids so COUNTD is a set size, not a string scan.

Read-only against the source workbook.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_data import find_source  # noqa: E402

# Located at runtime: --src, $SUPERSTORE_XLSX, ./data/, or the usual folders.
SRC = find_source()
OUT = Path(__file__).resolve().parent.parent / "build" / "data"

REGIONS = ["Central", "East", "South", "West"]
SEGMENTS = ["Consumer", "Corporate", "Home Office"]
CATEGORIES = ["Furniture", "Office Supplies", "Technology"]
SUB_CATEGORIES = {
    "Furniture": ["Bookcases", "Chairs", "Furnishings", "Tables"],
    "Office Supplies": [
        "Appliances", "Art", "Binders", "Envelopes", "Fasteners",
        "Labels", "Paper", "Storage", "Supplies",
    ],
    "Technology": ["Accessories", "Copiers", "Machines", "Phones"],
}
SUBCAT_ORDER = [s for c in CATEGORIES for s in SUB_CATEGORIES[c]]
EPOCH = date(2023, 1, 1)

# Columns, in the order they appear in every row array.
COLUMNS = ["day", "region", "segment", "subcat", "sales", "profit",
           "discount", "qty", "order", "cust", "returned"]


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: source not found: {SRC}", file=sys.stderr)
        return 2

    o = pd.read_excel(SRC, sheet_name="Orders")
    ret = pd.read_excel(SRC, sheet_name="Returns")
    ret_ids = set(ret["Order ID"].astype(str))

    o["Order Date"] = pd.to_datetime(o["Order Date"])
    day = (o["Order Date"].dt.date - EPOCH).map(lambda d: d.days).astype(int)

    region_i = o["Region"].map({r: i for i, r in enumerate(REGIONS)}).astype(int)
    segment_i = o["Segment"].map({s: i for i, s in enumerate(SEGMENTS)}).astype(int)
    subcat_i = o["Sub-Category"].map({s: i for i, s in enumerate(SUBCAT_ORDER)}).astype(int)

    order_i = pd.factorize(o["Order ID"].astype(str))[0]
    cust_i = pd.factorize(o["Customer Name"].astype(str))[0]

    cols = {
        "day": day.tolist(),
        "region": region_i.tolist(),
        "segment": segment_i.tolist(),
        "subcat": subcat_i.tolist(),
        "sales": [round(float(v), 4) for v in o["Sales"]],
        "profit": [round(float(v), 4) for v in o["Profit"]],
        "discount": [round(float(v), 4) for v in o["Discount"]],
        "qty": o["Quantity"].astype(int).tolist(),
        "order": order_i.tolist(),
        "cust": cust_i.tolist(),
        "returned": o["Order ID"].astype(str).isin(ret_ids).astype(int).tolist(),
    }

    # Guard: every index landed inside its dictionary.
    assert max(cols["region"]) < len(REGIONS)
    assert max(cols["segment"]) < len(SEGMENTS)
    assert max(cols["subcat"]) < len(SUB_CAT_ORDER := SUBCAT_ORDER)
    assert min(cols["day"]) >= 0

    month_count = (o["Order Date"].dt.year.max() - EPOCH.year) * 12 + \
                  o["Order Date"].dt.month.max()

    payload = {
        "meta": {
            "epoch": EPOCH.isoformat(),
            "columns": COLUMNS,
            "rowCount": len(o),
            "months": int(month_count),
            "dicts": {
                "region": REGIONS,
                "segment": SEGMENTS,
                "category": CATEGORIES,
                "subcat": SUBCAT_ORDER,
                "subcatCategory": {s: c for c in CATEGORIES for s in SUB_CATEGORIES[c]},
            },
        },
        "cols": cols,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "rows.json").write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    kb = (OUT / "rows.json").stat().st_size / 1024
    print(f"OK  rows={len(o)}  unique orders={order_i.max() + 1}  "
          f"unique customers={cust_i.max() + 1}")
    print(f"    returned lines={sum(cols['returned'])}  months={month_count}")
    print(f"    rows.json = {kb:,.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
