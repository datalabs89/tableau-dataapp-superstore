"""
Export the local Superstore dataset into the exact aggregates the data app needs.

Two outputs:
  build/data/superstore.json  -> the preview bundle (what the app renders locally)
  build/data/expectations.json -> independently shaped checksums for verification

The app itself, once published, gets these same numbers by querying Tableau at
runtime through ds.queryAsync(). This script exists so the preview is honest:
every figure it draws comes from the real 10,194-row dataset, not from invented
placeholder data.

Read-only against the source workbook. Writes only into build/data/.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_data import find_source  # noqa: E402

# Located at runtime: --src, $SUPERSTORE_XLSX, ./data/, or the usual folders.
SRC = find_source()
OUT = Path(__file__).resolve().parent.parent / "build" / "data"

CATEGORIES = ["Furniture", "Office Supplies", "Technology"]
SEGMENTS = ["Consumer", "Corporate", "Home Office"]
REGIONS = ["Central", "East", "South", "West"]
SUB_CATEGORIES = {
    "Furniture": ["Bookcases", "Chairs", "Furnishings", "Tables"],
    "Office Supplies": [
        "Appliances", "Art", "Binders", "Envelopes", "Fasteners",
        "Labels", "Paper", "Storage", "Supplies",
    ],
    "Technology": ["Accessories", "Copiers", "Machines", "Phones"],
}
SUBCAT_ORDER = [s for c in CATEGORIES for s in SUB_CATEGORIES[c]]
SUBCAT_TO_CAT = {s: c for c in CATEGORIES for s in SUB_CATEGORIES[c]}

# Discount bands. Edges chosen so the 30%+ band matches the "lost on orders
# discounted 30% or more" finding the executive summary leads with.
BAND_EDGES = [(0.0, 0.0, "No discount"), (0.0, 0.10, "1-10%"),
              (0.10, 0.20, "11-20%"), (0.20, 0.30, "21-30%"),
              (0.30, 1.01, "30% or more")]


def r2(x: float) -> float:
    return round(float(x), 2)


def r4(x: float) -> float:
    return round(float(x), 4)


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: source not found: {SRC}", file=sys.stderr)
        return 2

    orders = pd.read_excel(SRC, sheet_name="Orders")
    returns = pd.read_excel(SRC, sheet_name="Returns")
    orders["Order Date"] = pd.to_datetime(orders["Order Date"])
    orders["Ship Date"] = pd.to_datetime(orders["Ship Date"])

    n = len(orders)
    dmin, dmax = orders["Order Date"].min(), orders["Order Date"].max()
    sales = orders["Sales"].sum()
    profit = orders["Profit"].sum()

    # ---- headline KPIs ---------------------------------------------------
    kpis = {
        "sales": r2(sales),
        "profit": r2(profit),
        "margin": r4(profit / sales),
        "quantity": int(orders["Quantity"].sum()),
        "avgDiscount": r4(orders["Discount"].mean()),
        "orders": int(orders["Order ID"].nunique()),
        "customers": int(orders["Customer Name"].nunique()),
        "rows": n,
    }

    # ---- monthly series --------------------------------------------------
    mo = (orders.set_index("Order Date")
          .resample("MS")[["Sales", "Profit"]].sum().reset_index())
    monthly = {
        "months": [d.strftime("%Y-%m-%d") for d in mo["Order Date"]],
        "sales": [r2(v) for v in mo["Sales"]],
        "profit": [r2(v) for v in mo["Profit"]],
    }

    # ---- region rollup ---------------------------------------------------
    reg = (orders.groupby("Region")
           .agg(sales=("Sales", "sum"), profit=("Profit", "sum"),
                orders=("Order ID", "nunique"))
           .reindex(REGIONS).reset_index())
    region = [{
        "region": row.Region,
        "sales": r2(row.sales),
        "profit": r2(row.profit),
        "margin": r4(row.profit / row.sales) if row.sales else 0.0,
        "orders": int(row.orders),
    } for row in reg.itertuples()]

    # ---- category rollup (ranked bars, tab 2) ----------------------------
    cat = (orders.groupby("Category")
           .agg(sales=("Sales", "sum"), profit=("Profit", "sum"))
           .reindex(CATEGORIES).reset_index())
    category = [{
        "category": row.Category,
        "sales": r2(row.sales),
        "profit": r2(row.profit),
        "margin": r4(row.profit / row.sales) if row.sales else 0.0,
    } for row in cat.itertuples()]

    # ---- sub-category rollup --------------------------------------------
    sub = (orders.groupby("Sub-Category")
           .agg(sales=("Sales", "sum"), profit=("Profit", "sum"),
                discount=("Discount", "mean"), qty=("Quantity", "sum"),
                orders=("Order ID", "nunique"))
           .reindex(SUBCAT_ORDER)
           .rename_axis("subCategory").reset_index())
    subcategory = [{
        "subCategory": row.subCategory,
        "category": SUBCAT_TO_CAT[row.subCategory],
        "sales": r2(row.sales),
        "profit": r2(row.profit),
        "margin": r4(row.profit / row.sales) if row.sales else 0.0,
        "avgDiscount": r4(row.discount),
        "quantity": int(row.qty),
        "orders": int(row.orders),
    } for row in sub.itertuples()]

    # ---- discount bands --------------------------------------------------
    bands = []
    for lo, hi, label in BAND_EDGES:
        if lo == 0.0 and hi == 0.0:
            sel = orders[orders["Discount"] == 0.0]
        else:
            sel = orders[(orders["Discount"] > lo) & (orders["Discount"] <= hi)]
        s, p = sel["Sales"].sum(), sel["Profit"].sum()
        bands.append({
            "band": label,
            "sales": r2(s),
            "profit": r2(p),
            "margin": r4(p / s) if s else 0.0,
            "rows": int(len(sel)),
            "salesShare": r4(s / sales) if sales else 0.0,
        })

    # ---- heat grid: sub-category x region --------------------------------
    grid = (orders.groupby(["Sub-Category", "Region"])["Profit"].sum()
            .unstack(fill_value=0.0))
    heat = {
        "regions": REGIONS,
        "subCategories": SUBCAT_ORDER,
        "profit": [[r2(grid.at[s, rg]) if s in grid.index else 0.0
                    for rg in REGIONS] for s in SUBCAT_ORDER],
        "sales": [[r2(orders[(orders["Sub-Category"] == s) & (orders["Region"] == rg)]["Sales"].sum())
                   for rg in REGIONS] for s in SUBCAT_ORDER],
    }

    # ---- scatter: one point per order line, discount vs margin -----------
    # Full dataset, no sampling, so the preview scatter is exact.
    sc = orders[["Discount", "Profit", "Sales", "Sub-Category"]].copy()
    sc["margin"] = sc.apply(
        lambda x: (x["Profit"] / x["Sales"]) if x["Sales"] else 0.0, axis=1)
    sc = sc.sort_values(["Discount", "margin"], kind="stable")
    scatter = {
        "discount": [r4(v) for v in sc["Discount"]],
        "margin": [r4(v) for v in sc["margin"]],
        "sales": [r2(v) for v in sc["Sales"]],
        "subIdx": [SUBCAT_ORDER.index(s) for s in sc["Sub-Category"]],
        "count": int(len(sc)),
        # moments so a verifier can reconstruct mean margin / discount
        "sumDiscount": r4(sc["Discount"].sum()),
        "sumMargin": r4(sc["margin"].sum()),
    }

    # ---- per-state rollup (context table) --------------------------------
    st = (orders.groupby("State/Province")
          .agg(sales=("Sales", "sum"), profit=("Profit", "sum"),
               orders=("Order ID", "nunique"))
          .rename_axis("state").reset_index())
    states = [{
        "state": row.state,
        "sales": r2(row.sales),
        "profit": r2(row.profit),
        "margin": r4(row.profit / row.sales) if row.sales else 0.0,
        "orders": int(row.orders),
    } for row in st.sort_values("profit").itertuples()]

    # ---- returns join ----------------------------------------------------
    ret_ids = set(returns["Order ID"].astype(str))
    orders["returned"] = orders["Order ID"].astype(str).isin(ret_ids)
    ret = orders.groupby("returned").agg(
        sales=("Sales", "sum"), profit=("Profit", "sum"),
        orders=("Order ID", "nunique")).reset_index()
    returns_agg = {("returned" if row.returned else "kept"): {
        "sales": r2(row.sales), "profit": r2(row.profit), "orders": int(row.orders),
    } for row in ret.itertuples()}

    # ---- segmentation by discount ---------------------------------------
    disc30 = orders[orders["Discount"] >= 0.30]
    undisc = orders[orders["Discount"] == 0.0]
    loss_months = [(m, r2(p)) for m, p in zip(monthly["months"], monthly["profit"]) if p < 0]
    worst_sub = min(subcategory, key=lambda d: d["profit"])
    worst_cell = None
    for i, s in enumerate(SUBCAT_ORDER):
        for j, rg in enumerate(REGIONS):
            v = heat["profit"][i][j]
            if worst_cell is None or v < worst_cell["profit"]:
                worst_cell = {"subCategory": s, "region": rg, "profit": v}
    best_reg = max(region, key=lambda d: d["margin"])
    worst_reg = min(region, key=lambda d: d["margin"])

    exec_summary = [
        {
            "kicker": "Discounting",
            "value": r2(disc30["Profit"].sum()),
            "valueLabel": "profit lost to 30%+ discounts",
            "body": (
                f"Orders discounted 30% or more are "
                f"{disc30['Sales'].sum() / sales * 100:.0f}% of sales and lose "
                f"${abs(disc30['Profit'].sum()):,.0f}. Undiscounted orders earn a "
                f"{undisc['Profit'].sum() / undisc['Sales'].sum() * 100:.1f}% margin."
            ),
            "filter": "30% or more",
        },
        {
            "kicker": "Product mix",
            "value": r2(worst_sub["profit"]),
            "valueLabel": f"{worst_sub['subCategory']} is the biggest loss-maker",
            "body": (
                f"{worst_sub['subCategory']} lost ${abs(worst_sub['profit']):,.0f} on "
                f"${worst_sub['sales']:,.0f} of sales at a "
                f"{worst_sub['avgDiscount'] * 100:.1f}% average discount. "
                f"{sum(1 for d in subcategory if d['profit'] < 0)} of "
                f"{len(subcategory)} sub-categories lose money."
            ),
            "filter": worst_sub["subCategory"],
        },
        {
            "kicker": "Hot spot",
            "value": r2(worst_cell["profit"]),
            "valueLabel": f"{worst_cell['subCategory']} in the {worst_cell['region']}",
            "body": (
                f"{worst_cell['subCategory']} in the {worst_cell['region']} is the worst "
                f"cell on the grid: ${abs(worst_cell['profit']):,.0f} lost. "
                f"Click the region to filter every panel."
            ),
            "filter": worst_cell["region"],
        },
        {
            "kicker": "Regions",
            "value": r4(best_reg["margin"]),
            "valueLabel": f"{best_reg['margin'] * 100:.1f}% margin in the {best_reg['region']}",
            "body": (
                f"The {best_reg['region']} runs at a {best_reg['margin'] * 100:.1f}% margin; "
                f"the {worst_reg['region']} only reaches {worst_reg['margin'] * 100:.1f}%. "
                f"The spread is {(best_reg['margin'] - worst_reg['margin']) * 100:.1f} points."
            ),
            "filter": best_reg["region"],
        },
    ]

    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": SRC.name,
            "sheet": "Orders",
            "dateMin": dmin.strftime("%Y-%m-%d"),
            "dateMax": dmax.strftime("%Y-%m-%d"),
            "rowCount": n,
            "filters": {"regions": REGIONS, "segments": SEGMENTS,
                        "categories": CATEGORIES, "subCategories": SUBCAT_ORDER},
            "returnsSheetRows": int(len(returns)),
        },
        "kpis": kpis,
        "execSummary": exec_summary,
        "lossMonths": loss_months,
        "monthly": monthly,
        "region": region,
        "category": category,
        "subcategory": subcategory,
        "discountBands": bands,
        "heat": heat,
        "scatter": scatter,
        "states": states,
        "returns": returns_agg,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "superstore.json").write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    expectations = {
        "note": "Independent recomputation from the source workbook for render verification.",
        "rowCount": n,
        "kpis": kpis,
        "checked": {
            "sumSubCategoryProfit": r2(sum(d["profit"] for d in subcategory)),
            "sumCategorySales": r2(sum(d["sales"] for d in category)),
            "sumRegionSales": r2(sum(d["sales"] for d in region)),
            "sumMonthlySales": r2(sum(monthly["sales"])),
            "sumBandSales": r2(sum(b["sales"] for b in bands)),
            "sumBandRows": sum(b["rows"] for b in bands),
            "sumHeatCellsProfit": r2(sum(sum(r) for r in heat["profit"])),
            "scatterCount": scatter["count"],
            "lossMonthCount": len(loss_months),
            "negativeSubCategories": [d["subCategory"] for d in subcategory if d["profit"] < 0],
        },
    }
    (OUT / "expectations.json").write_text(
        json.dumps(expectations, indent=2), encoding="utf-8")

    size_kb = (OUT / "superstore.json").stat().st_size / 1024
    print(f"OK  rows={n}  range={dmin:%Y-%m-%d}..{dmax:%Y-%m-%d}")
    print(f"    sales=${kpis['sales']:,.2f}  profit=${kpis['profit']:,.2f}  "
          f"margin={kpis['margin'] * 100:.2f}%")
    print(f"    superstore.json = {size_kb:,.0f} KB")
    print(f"    loss months: {len(loss_months)}  negative sub-cats: "
          f"{len(expectations['checked']['negativeSubCategories'])}")
    print(f"    sum(subcat profit) = {expectations['checked']['sumSubCategoryProfit']:,.2f} "
          f"(vs profit {kpis['profit']:,.2f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
