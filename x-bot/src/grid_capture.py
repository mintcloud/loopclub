"""
Screenshot (or short video) the LIVE grid at app.loopclub.xyz using a headless
browser. This is the "real capture" media tier the strategy doc calls the
highest-leverage asset (Day 4 — "the unedited capture").

STATUS: blocked on this VPS as of 2026-07-04 — Playwright's Chromium needs
system shared libs (libnspr4, libnss3, etc.) that aren't installed and
require sudo. See x-bot/README.md "Blocked: browser capture" for the exact
command to run once, then this script works as-is.

Usage:
    python3 grid_capture.py --out grid.png                       # screenshot
    python3 grid_capture.py --out grid.png --jam <link>           # screenshot a specific loop
    python3 grid_capture.py --out grid.webm --video --seconds 20  # short video capture
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

BASE_URL = "https://app.loopclub.xyz"


def screenshot(out_path: str, jam: str = None):
    url = f"{BASE_URL}/?jam={jam}" if jam else BASE_URL
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(url, timeout=30000)
        page.wait_for_timeout(2500)  # let the grid render/animate in
        page.screenshot(path=out_path)
        browser.close()
    print(f"[grid_capture] saved {out_path}", file=sys.stderr)


def video(out_path: str, seconds: int = 20, jam: str = None):
    import os
    import shutil

    url = f"{BASE_URL}/?jam={jam}" if jam else BASE_URL
    tmp_dir = out_path + ".video_tmp"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            record_video_dir=tmp_dir,
            record_video_size={"width": 1280, "height": 900},
        )
        page = context.new_page()
        page.goto(url, timeout=30000)
        page.wait_for_timeout(seconds * 1000)
        context.close()
        browser.close()

    # Playwright writes a randomly-named file inside tmp_dir; move it to out_path.
    files = [f for f in os.listdir(tmp_dir) if f.endswith(".webm")]
    if files:
        shutil.move(os.path.join(tmp_dir, files[0]), out_path)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        print(f"[grid_capture] saved {out_path}", file=sys.stderr)
    else:
        print("[grid_capture] no video file produced", file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--jam", default=None, help="jam param to load a specific loop")
    ap.add_argument("--video", action="store_true")
    ap.add_argument("--seconds", type=int, default=20)
    args = ap.parse_args()

    if args.video:
        video(args.out, args.seconds, args.jam)
    else:
        screenshot(args.out, args.jam)


if __name__ == "__main__":
    main()
