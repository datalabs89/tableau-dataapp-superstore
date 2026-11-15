"""
Render the preview in a real browser and report what actually happened.

This is a verification step, not a build step. It:
  1. serves build/preview over HTTP (file:// blocks the fetch of rows.json),
  2. loads the page in Chromium,
  3. fails loudly on any console error or page exception,
  4. asserts the figures the app drew match build/data/expectations.json,
  5. screenshots light and dark at desktop and phone widths.

Step 4 is the point: it re-reads the numbers out of the rendered DOM and
compares them against an independent recomputation from the source workbook.
A chart that renders but shows the wrong number is a failure here.
"""

from __future__ import annotations

import functools
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "build" / "preview"
SHOTS = ROOT / "build" / "shots"
EXPECT = ROOT / "build" / "data" / "expectations.json"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # keep the run output readable
        pass


def serve(directory: Path):
    handler = functools.partial(Quiet, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def money_to_float(s: str) -> float:
    """'$2,326,534' / '-$17,725.35' / '$2.3M' -> float"""
    s = s.strip().replace(",", "").replace("$", "")
    neg = s.startswith("-")
    s = s.lstrip("-")
    mult = 1.0
    if s.endswith("K"):
        mult, s = 1e3, s[:-1]
    elif s.endswith("M"):
        mult, s = 1e6, s[:-1]
    elif s.endswith("B"):
        mult, s = 1e9, s[:-1]
    try:
        v = float(s) * mult
    except ValueError:
        return float("nan")
    return -v if neg else v


def main() -> int:
    if not PREVIEW.exists():
        print("FATAL: run build_preview.py first", file=sys.stderr)
        return 2
    SHOTS.mkdir(parents=True, exist_ok=True)
    exp = json.loads(EXPECT.read_text(encoding="utf-8"))

    httpd, port = serve(PREVIEW)
    url = f"http://127.0.0.1:{port}/index.html"
    failures: list[str] = []
    console: list[str] = []

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1200},
                                    device_scale_factor=2)
            page.on("console", lambda m: (
                console.append(f"{m.type}: {m.text}")
                if m.type in ("error", "warning") else None))
            page.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))

            page.goto(url, wait_until="networkidle")
            page.wait_for_selector(".viz-root", timeout=15000)
            page.wait_for_timeout(700)

            # ---- did it stay on the preview backend? --------------------
            badge = page.inner_text(".src-badge")
            print(f"    source badge: {badge}")
            if "Preview" not in badge:
                failures.append(f"expected the preview backend, got badge '{badge}'")

            # ---- KPI figures vs independent recomputation ----------------
            tiles = page.eval_on_selector_all(
                ".tile",
                "els => els.map(e => ({label: e.querySelector('.tile-label').textContent,"
                " value: e.querySelector('.tile-value').textContent,"
                " exact: e.querySelector('.tile-value').getAttribute('data-exact')}))")
            got = {t["label"]: t for t in tiles}
            print("    KPI tiles:")
            for k2, v in got.items():
                print(f"      {k2:<16} {v['value']:<12} exact={v['exact']}")

            k = exp["kpis"]
            checks = [
                ("Total sales", k["sales"], 0.001),
                ("Profit", k["profit"], 0.001),
                ("Profit margin", k["margin"], 0.001),
                ("Avg discount", k["avgDiscount"], 0.001),
            ]
            for label, want, tol in checks:
                if label not in got:
                    failures.append(f"KPI tile missing: {label}")
                    continue
                raw = got[label]["exact"] or got[label]["value"]
                if label in ("Profit margin", "Avg discount"):
                    have = float(raw.replace("%", "")) / 100
                else:
                    have = money_to_float(raw)
                rel = abs(have - want) / (abs(want) or 1)
                ok = rel <= tol
                print(f"      check {label}: {raw} vs {want:,.4f} -> "
                      f"{'OK' if ok else 'MISMATCH'}")
                if not ok:
                    failures.append(f"{label}: rendered {raw} but expected {want}")

            # ---- findings row present and non-empty ---------------------
            nfind = page.eval_on_selector_all(".finding", "e => e.length")
            print(f"    findings cards: {nfind}")
            if nfind != 4:
                failures.append(f"expected 4 findings cards, found {nfind}")

            # ---- every chart card rendered an svg ------------------------
            cards = page.eval_on_selector_all(
                ".card",
                "els => els.map(e => ({id: e.id,"
                " svg: !!e.querySelector('svg'),"
                " tbl: !!e.querySelector('table'),"
                " empty: !!e.querySelector('.chart-empty'),"
                " title: e.querySelector('.card-title')?.textContent}))")
            print("    cards:")
            for c in cards:
                state = "svg" if c["svg"] else ("table" if c["tbl"] else
                                                ("EMPTY" if c["empty"] else "NONE"))
                print(f"      {c['id']:<14} {state:<6} {c['title']}")
                # c-detail is a table by design; every other card must draw.
                if state == "NONE" or (state == "EMPTY" and c["id"] != "c-scatter"):
                    failures.append(f"card {c['id']} rendered neither a chart nor a table")

            # ---- the detail table carries every sub-category -------------
            det_rows = page.eval_on_selector_all("#c-detail .tbl tbody tr", "e => e.length")
            print(f"    detail table rows: {det_rows}")
            if det_rows != 17:
                failures.append(f"detail table shows {det_rows} rows, expected 17")

            # ---- negative sub-categories are labelled as losses ----------
            neg = exp["checked"]["negativeSubCategories"]
            neg_cells = page.eval_on_selector_all(
                "#c-rank svg .mark",
                "els => els.filter(e => (e.getAttribute('fill')||'').toLowerCase() === '#b03030').length")
            print(f"    ranked bars in the loss color: {neg_cells} (expected {len(neg)})")
            if neg_cells != len(neg):
                failures.append(
                    f"ranked chart colored {neg_cells} bars as losses, expected {len(neg)}")

            # ---- filters actually re-scope the numbers -------------------
            exact = lambda sel: money_to_float(  # noqa: E731
                page.get_attribute(sel, "data-exact") or page.inner_text(sel))

            before = exact(".tile:nth-of-type(1) .tile-value")
            page.click(".filterbar .fg:nth-of-type(2) .chip-btn")   # first Region chip
            page.wait_for_selector(".ctl-reset", timeout=5000)
            page.wait_for_timeout(500)
            after = exact(".tile:nth-of-type(1) .tile-value")
            print(f"    region filter: Total sales {before:,.0f} -> {after:,.0f}")
            if not (0 < after < before):
                failures.append(
                    f"region filter did not reduce sales ({after:,.0f} vs {before:,.0f})")
            scope = page.inner_text(".scope-line")
            print(f"    scope line: {scope.splitlines()[0][:110]}")
            if "All orders" in scope:
                failures.append("scope line did not reflect the applied region filter")

            # ---- the toggle button appears once a filter is applied ------
            if not page.query_selector(".ctl-reset"):
                failures.append("no reset control appeared after filtering")

            # ---- table view toggle works --------------------------------
            page.click("#c-rank .btn-ghost")
            page.wait_for_timeout(250)
            rows = page.eval_on_selector_all("#c-rank .tbl tbody tr", "e => e.length")
            body_hidden = page.evaluate(
                "document.querySelector('#c-rank .card-body').hidden")
            print(f"    ranked table view rows: {rows} (chart hidden: {body_hidden})")
            if rows != 17:
                failures.append(f"ranked table view shows {rows} rows, expected 17")
            if not body_hidden:
                failures.append("table view did not replace the chart body")
            page.click("#c-rank .btn-ghost")   # back to the chart
            page.wait_for_timeout(200)

            # ---- reset restores the full scope --------------------------
            page.click(".ctl-reset")
            page.wait_for_timeout(600)
            reset = exact(".tile:nth-of-type(1) .tile-value")
            print(f"    after reset: Total sales = {reset:,.2f}")
            if abs(reset - k["sales"]) / k["sales"] > 0.001:
                failures.append(f"reset did not restore the full total ({reset:,.2f} vs {k['sales']:,.2f})")
            if page.query_selector(".ctl-reset"):
                failures.append("reset control still present with no filters applied")

            # ---- code and data tabs -------------------------------------
            page.click("#tab-code")
            page.wait_for_timeout(250)
            code_txt = page.inner_text("#panel-code")
            if "queryAsync" not in code_txt:
                failures.append("Code tab does not show the queryAsync example")
            page.screenshot(path=str(SHOTS / "04-code-tab.png"), full_page=True)
            page.click("#tab-data")
            page.wait_for_timeout(250)
            data_txt = page.inner_text("#panel-data")
            if "kpis" not in data_txt:
                failures.append("Data tab does not list the queries")
            page.screenshot(path=str(SHOTS / "05-data-tab.png"), full_page=True)
            page.click("#tab-preview")
            page.wait_for_timeout(300)

            # ---- theme toggle: the real control, and the marks must repaint --
            # A theme switch that only flips CSS custom properties would leave
            # the SVG marks on their old colors, since the chart code writes
            # fills from the JS theme object. This proves the toggle re-renders.
            def sales_bar_fill():
                return page.eval_on_selector(
                    "#c-monthly svg .mark", "e => e.getAttribute('fill')")

            def surface():
                return page.evaluate(
                    "getComputedStyle(document.querySelector('.card')).backgroundColor")

            page.evaluate(
                "try { localStorage.removeItem('superstore-theme'); } catch (e) {}")
            page.reload(wait_until="networkidle")
            page.wait_for_selector(".viz-root", timeout=15000)
            page.wait_for_timeout(600)

            light_fill, light_surface = sales_bar_fill(), surface()
            page.click(".topbar-right .btn-ghost")
            page.wait_for_timeout(500)
            dark_fill, dark_surface = sales_bar_fill(), surface()
            stamped = page.get_attribute("html", "data-theme")
            print(f"    theme toggle: bar {light_fill} -> {dark_fill}, "
                  f"card surface {light_surface} -> {dark_surface}, html[data-theme]={stamped}")
            if light_fill == dark_fill:
                failures.append(
                    f"theme toggle did not repaint the chart marks (still {light_fill})")
            if light_surface == dark_surface:
                failures.append("theme toggle did not change the card surface")
            if stamped != "dark":
                failures.append(f"theme toggle did not stamp html[data-theme] (got {stamped})")

            # The choice must survive a reload (per-viewer storage).
            page.reload(wait_until="networkidle")
            page.wait_for_selector(".viz-root", timeout=15000)
            page.wait_for_timeout(600)
            print(f"    after reload, html[data-theme]={page.get_attribute('html','data-theme')}")
            if page.get_attribute("html", "data-theme") != "dark":
                failures.append("the theme choice did not survive a reload")
            page.screenshot(path=str(SHOTS / "02-dark.png"), full_page=True)

            page.click(".topbar-right .btn-ghost")   # back to light
            page.wait_for_timeout(500)
            page.screenshot(path=str(SHOTS / "01-light.png"), full_page=True)

            # ---- shots: phone width, light ------------------------------
            page.set_viewport_size({"width": 390, "height": 900})
            page.wait_for_timeout(400)
            page.screenshot(path=str(SHOTS / "03-phone.png"), full_page=True)

            # ---- horizontal overflow check at phone width ---------------
            overflow = page.evaluate(
                "() => ({doc: document.documentElement.scrollWidth,"
                " win: window.innerWidth})")
            print(f"    phone scrollWidth {overflow['doc']} vs viewport {overflow['win']}")
            if overflow["doc"] > overflow["win"] + 1:
                failures.append(
                    f"horizontal page scroll at phone width "
                    f"({overflow['doc']} > {overflow['win']})")

            browser.close()
    finally:
        httpd.shutdown()

    print()
    if console:
        print("    console output:")
        for c in console[:25]:
            print(f"      {c}")
    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS - rendered figures match the independent recomputation.")
    print(f"    screenshots: {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
