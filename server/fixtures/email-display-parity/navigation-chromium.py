#!/usr/bin/env python3
"""Offline file-only Chromium runner, using already-installed Python Playwright."""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

fixture, width, height = sys.argv[1:4]
external = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=[
        "--no-sandbox", "--disable-gpu", "--disable-background-networking",
        "--disable-component-update", "--disable-default-apps", "--no-first-run",
        "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND",
    ])
    context = browser.new_context(viewport={"width": int(width), "height": int(height)}, device_scale_factor=1)
    def route(request):
        if request.request.url.startswith(("file:", "data:")):
            request.continue_()
        else:
            external.append(request.request.url)
            request.abort("blockedbyclient")
    context.route("**/*", route)
    page = context.new_page()
    page.goto(Path(fixture).resolve().as_uri(), wait_until="load", timeout=10000)
    page.wait_for_selector("#navigation-result", state="attached", timeout=10000)
    result = json.loads(base64.b64decode(page.locator("#navigation-result").text_content()).decode("utf-8"))
    result["browserExternalRequests"] = external
    if Path(fixture).name == "navigation-candidate.html":
        page.screenshot(path=str(Path(fixture).parent / f"navigation-candidate-{width}x{height}.png"), timeout=5000)
    print(json.dumps(result, ensure_ascii=False))
    context.close()
    browser.close()
