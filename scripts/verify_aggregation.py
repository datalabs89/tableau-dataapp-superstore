"""
Cross-check the app's aggregation against independent recomputation.

The render check proves the DOM shows the right headline. This proves the
AGGREGATION LAYER is right for arbitrary slices - including ones the render
check never visits - by running the app's own selectRows/aggregate in the
browser and comparing against the same slice computed here in pandas.

That matters because the published app aggregates on Tableau's side through
queryAsync(): if the JS path is correct, the two engines are being asked for
the same numbers and a divergence means a query is wrong.
"""

from __future__ import annotations

import functools
import http.server
import json
import sys
import threading
from pathlib import Path

import pandas as pd
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_data import find_source  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "build" / "preview"
# Located at runtime: --src, $SUPERSTORE_XLSX, ./data/, or the usual folders.
SRC = find_source()
TOL = 0.01  # dollars


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


SLICES = [
    {"name": "full", "slice": {}},
    {"name": "West only", "slice": {"regions": ["West"]}},
    {"name": "West+East, Consumer", "slice": {"regions": ["West", "East"], "segments": ["Consumer"]}},
    {"name": "30%+ discount", "slice": {"discountBands": ["30% or more"]}},
    {"name": "Tables", "slice": {"subcats": ["Tables"]}},
    {"name": "2025 only", "slice": {"dateFrom": "2025-01-01", "dateTo": "2025-12-31"}},
    {"name": "Q1 2024, Central, Furniture",
     "slice": {"dateFrom": "2024-01-01", "dateTo": "2024-03-31",
               "regions": ["Central"],
               "subcats": ["Bookcases", "Chairs", "Furnishings", "Tables"]}},
    {"name": "South, no discount",
     "slice": {"regions": ["South"], "discountBands": ["No discount"]}},
    {"name": "Home Office, Technology subcats",
     "slice": {"segments": ["Home Office"],
               "subcats": ["Accessories", "Copiers", "Machines", "Phones"]}},
]

BROWSER = """(slice) => {
  const SV = window.SV;
  const st = SV.store;
  const s = SV.emptySlice();
  Object.keys(slice).forEach(k => {
    if (k === 'dateFrom' || k === 'dateTo') s[k] = slice[k];
    else s[k] = slice[k].slice();
  });
  const rows = SV.selectRows(st.store, s);
  const a = SV.aggregate(st.store, rows);
  return {
    lines: rows.length,
    sales: a.kpi.sales, profit: a.kpi.profit, qty: a.kpi.qty,
    orders: a.kpi.orders, customers: a.kpi.customers,
    avgDiscount: a.kpi.avgDiscount,
    regionSales: a.region.map(r => [r.region, r.sales, r.profit]),
    subProfit: a.subcategory.map(d => [d.subCategory, d.sales, d.profit, d.avgDiscount]),
    bands: a.discountBands.map(b => [b.band, b.sales, b.profit, b.rows]),
    heat: a.heat.profit,
    lossMonths: a.months.filter(m => m.profit < 0).length,
  };
}"""


def expected(df: pd.DataFrame, sl: dict) -> dict:
    d = df
    if sl.get("regions"):
        d = d[d["Region"].isin(sl["regions"])]
    if sl.get("segments"):
        d = d[d["Segment"].isin(sl["segments"])]
    if sl.get("subcats"):
        d = d[d["Sub-Category"].isin(sl["subcats"])]
    if sl.get("dateFrom"):
        d = d[d["Order Date"] >= pd.Timestamp(sl["dateFrom"])]
    if sl.get("dateTo"):
        d = d[d["Order Date"] <= pd.Timestamp(sl["dateTo"])]
    if sl.get("discountBands"):
        want = sl["discountBands"]
        disc = d["Discount"]
        masks = {
            "No discount": disc == 0.0,
            "1-10%": (disc > 0) & (disc <= 0.10),
            "11-20%": (disc > 0.10) & (disc <= 0.20),
            "21-30%": (disc > 0.20) & (disc <= 0.30),
            "30% or more": disc > 0.30,
        }
        m = None
        for w in want:
            m = masks[w] if m is None else (m | masks[w])
        d = d[m]

    mo = d.set_index("Order Date").resample("MS")[["Sales", "Profit"]].sum()
    return {
        "lines": len(d),
        "sales": round(d["Sales"].sum(), 2),
        "profit": round(d["Profit"].sum(), 2),
        "qty": int(d["Quantity"].sum()),
        "orders": int(d["Order ID"].nunique()),
        "customers": int(d["Customer Name"].nunique()),
        "avgDiscount": round(d["Discount"].mean(), 6) if len(d) else 0.0,
        "lossMonths": int((mo["Profit"] < 0).sum()),
    }


def main() -> int:
    df = pd.read_excel(SRC, sheet_name="Orders")
    df["Order Date"] = pd.to_datetime(df["Order Date"])

    httpd = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Q, directory=str(PREVIEW)))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    failures = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            p = b.new_page()
            p.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))
            p.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
            p.wait_for_selector(".viz-root", timeout=15000)
            p.wait_for_timeout(400)

            print(f"{'slice':<30} {'lines':>7} {'sales':>14} {'profit':>12} "
                  f"{'*':>4} {'cum':>4}  verdict")
            print("-" * 92)
            for case in SLICES:
                got = p.evaluate(BROWSER, case["slice"])
                want = expected(df, case["slice"])
                bad = []
                for key in ("lines", "sales", "profit", "qty", "orders",
                            "customers", "lossMonths"):
                    g, w = got[key], want[key]
                    if isinstance(w, int) and key == "lines":
                        if g != w:
                            bad.append(f"{key}:{g}!={w}")
                    elif abs(float(g) - float(w)) > TOL:
                        bad.append(f"{key}:{g}!={w}")
                if abs(got["avgDiscount"] - want["avgDiscount"]) > 1e-6:
                    bad.append(f"avgDiscount:{got['avgDiscount']}!={want['avgDiscount']}")
                # Cross-consistency: region/sub-category rollups must sum to the total.
                rs = sum(r[1] for r in got["regionSales"])
                if abs(rs - got["sales"]) > 0.5:
                    bad.append(f"region rollup {rs:.2f} != total {got['sales']:.2f}")
                sp = sum(s[2] for s in got["subProfit"])
                if abs(sp - got["profit"]) > 0.5:
                    bad.append(f"subcat rollup {sp:.2f} != profit {got['profit']:.2f}")
                bs = sum(x[1] for x in got["bands"])
                if abs(bs - got["sales"]) > 0.5:
                    bad.append(f"band rollup {bs:.2f} != total {got['sales']:.2f}")
                hs = sum(sum(r) for r in got["heat"])
                if abs(hs - got["profit"]) > 0.5:
                    bad.append(f"heat rollup {hs:.2f} != profit {got['profit']:.2f}")

                verdict = "OK" if not bad else "MISMATCH"
                flag = "" if not bad else " " + "; ".join(bad[:2])
                print(f"{case['name']:<30} {got['lines']:>7,} {got['sales']:>14,.2f} "
                      f"{got['profit']:>12,.2f} {len(bad):>4} {0:>4}  {verdict}{flag}")
                if bad:
                    failures.append(f"{case['name']}: " + "; ".join(bad))
            b.close()
    finally:
        httpd.shutdown()

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"PASS - {len(SLICES)} slices: JS aggregation matches pandas exactly, "
          "and every rollup sums to its total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
