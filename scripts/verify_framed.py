"""
Run the app's own page inside a frame that mimics Tableau's extension host.

The render check loads index.html as a top-level page, which is NOT how Tableau
loads it: Tableau puts the page in a sandboxed cross-origin iframe and talks to
it over postMessage. A page that works standalone can still fail in that context
- a blocked frame, a refused fetch, a script that assumes it owns the window.

This harness serves two origins, loads the app's real index.html inside a
cross-origin iframe, and reports console errors and what the app mounted. It
cannot stand in for Tableau (there is no Tableau here to answer initializeAsync),
so the app is expected to reach its fallback path - what is being checked is
that the page BOOTS and BINDS inside a frame at all, with no errors.
"""

from __future__ import annotations

import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "build" / "preview"

# Parent page: a cross-origin host frame, like Tableau's, that embeds the app.
HOST_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>host</title></head>
<body style="margin:0">
<iframe id="ext" src="{app_url}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style="width:1400px;height:900px;border:0"></iframe>
</body></html>
"""


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory: Path):
    handler = functools.partial(Q, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def main() -> int:
    if not PREVIEW.is_dir():
        print("FATAL: run build_preview.py first", file=sys.stderr)
        return 2

    httpd, app_port = serve(PREVIEW)
    # The host page lives on a DIFFERENT origin, so the frame is cross-origin
    # exactly as Tableau's would be.
    hostdir = ROOT / "build" / "_hostframe"
    hostdir.mkdir(parents=True, exist_ok=True)
    app_url = f"http://127.0.0.1:{app_port}/index.html"
    (hostdir / "host.html").write_text(HOST_PAGE.format(app_url=app_url),
                                       encoding="utf-8")
    hostd, host_port = serve(hostdir)

    failures: list[str] = []
    console: list[str] = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            page = b.new_page(viewport={"width": 1440, "height": 950})
            page.on("console", lambda m: console.append(f"{m.type}: {m.text}")
                    if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))

            page.goto(f"http://127.0.0.1:{host_port}/host.html",
                      wait_until="networkidle")
            # Inside a frame the app correctly takes the TABLEAU path: it calls
            # initializeAsync() and only falls back when that does not answer.
            # main.js bounds that wait at 8s, so the harness has to outwait it -
            # checking at 2.5s sees a healthy app mid-handshake and reads it as
            # a failure.
            page.wait_for_timeout(11000)

            frame = next((f for f in page.frames
                          if f.url.rstrip("/").endswith("index.html")), None)
            if frame is None:
                failures.append("the app frame never loaded")
            else:
                print(f"    frame url  : {frame.url}")
                mounted = frame.evaluate("!!document.querySelector('.viz-root')")
                fallback = frame.evaluate(
                    "!!document.querySelector('.error-box, .error')")
                print(f"    mounted    : {mounted}")
                print(f"    fallback   : {fallback}")
                if not (mounted or fallback):
                    failures.append(
                        "the app neither mounted nor showed a fallback in a frame")
                if mounted:
                    n = frame.evaluate("document.querySelectorAll('.tile').length")
                    c = frame.evaluate("document.querySelectorAll('.card').length")
                    print(f"    tiles/cards: {n}/{c}")
                    if n == 0 or c == 0:
                        failures.append("frame mounted but rendered no content")

            blocked = [c for c in console if "Refused" in c or "blocked" in c.lower()]
            print(f"    blocked requests: {len(blocked)}")
            for c in blocked[:5]:
                print(f"      {c[:150]}")
            b.close()
    finally:
        httpd.shutdown()
        hostd.shutdown()
        import shutil
        shutil.rmtree(hostdir, ignore_errors=True)

    print()
    for c in console[:8]:
        print(f"    console: {c[:160]}")
    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS - the app boots and binds inside a cross-origin sandboxed frame.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
