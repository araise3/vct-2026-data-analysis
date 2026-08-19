"""
Opens every linked tracker.gg profile (src/lib/trackerLinks.json) at the
Competitive Overview tab for one VALORANT Act, and saves a screenshot of the
overview section (rank/level/W-L ring, the 4 giant stat pills, the counting
stats row, and the Tracker Score row) to disk -- a real-world sample to
compare against this site's own player_act_stats.json numbers, since
tracker.gg publishes no API for this data (see fetch_act_stats.py's own
docstring for why the site's Ranked stats come from HenrikDev instead).

Drives a real Chromium via Playwright, not raw HTTP -- tracker.gg's profile
PAGES render for anyone with a normal browser (this is exactly what a person
clicking through would see); it's only their INTERNAL api.tracker.gg
endpoints that are off-limits (see fetch_act_stats.py's own docstring on
that). One request at a time with a real delay between them, same
politeness convention as this repo's own scrapers.

HEADLESS GETS CLOUDFLARE-CHALLENGED -- USE --headful
------------------------------------------------------
Confirmed live: headless Chromium hits tracker.gg's Cloudflare "Performing
security verification" interstitial instead of the real page (title "Just a
moment...", no stats markup at all). This is the same Cloudflare protection
fetch_act_stats.py's own docstring already documents for their internal
API, just also covering the plain profile pages when the client looks
automated. No fingerprinting workaround was attempted here (stealth
plugins, spoofed headers, cookie/session reuse from another tool) --
deliberately: that's circumventing a site's own active anti-bot measure,
not a bug to patch around. `--headful` (a real, visible browser window) is
the one lever this script exposes, since a normal visible browser session
is what tracker.gg is trying to distinguish FROM a bot in the first place,
not a workaround targeting their detection specifically -- run it from a
real desktop, not a headless CI/sandboxed environment (this repo's own
sandbox has no display server, so --headful can't even launch there).

SETUP
-----
    pip install playwright
    python -m playwright install chromium

USAGE
-----
    python data_prep/screenshot_tracker_overviews.py --headful             # everyone
    python data_prep/screenshot_tracker_overviews.py --headful --handles kozzy azury
    python data_prep/screenshot_tracker_overviews.py --headful --limit 10
    python data_prep/screenshot_tracker_overviews.py --headful --season <guid> --delay 3

Screenshots land in data_prep/tracker_screenshots/{handle}.png (gitignored --
these are a local QA aid, not data the site ships). Re-running skips a
handle whose screenshot already exists unless --overwrite is passed, so an
interrupted batch resumes cheaply.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINKS_PATH = os.path.join(_REPO_ROOT, "src", "lib", "trackerLinks.json")
OUT_DIR = os.path.join(_REPO_ROOT, "data_prep", "tracker_screenshots")

# V26 Act 4 -- the season id baked into the URL format the user supplied.
# Every other Act's id can be read off its own tracker.gg profile URL (the
# `season=` query param) and passed via --season.
DEFAULT_SEASON = "4f0864e2-40af-28a4-de2c-0e9e64e75f23"

VIEWPORT = {"width": 1280, "height": 1000}
NAV_TIMEOUT_MS = 30_000
OVERVIEW_SELECTOR = ".area-main-stats"
# Politeness floor between page loads -- this is browsing profile pages one
# at a time like a real visitor would, not hammering an API.
DEFAULT_DELAY_S = 2.5


def load_targets(handles_filter=None, limit=None):
    with open(LINKS_PATH, encoding="utf-8") as f:
        links = json.load(f)
    targets = []
    for handle, accounts in sorted(links.items()):
        if not accounts:
            continue
        riot_id = accounts[0].get("riotId")
        if not riot_id:
            continue
        targets.append((handle, riot_id))
    if handles_filter:
        wanted = {h.lower() for h in handles_filter}
        targets = [t for t in targets if t[0].lower() in wanted]
    if limit:
        targets = targets[:limit]
    return targets


def profile_url(riot_id, season):
    # matches e.g. "VIT Sayonara#gud" -> ".../VIT%20Sayonara%23gud/..."
    encoded = urllib.parse.quote(riot_id, safe="")
    return (
        f"https://tracker.gg/valorant/profile/riot/{encoded}/overview"
        f"?platform=pc&playlist=competitive&season={season}"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--handles", nargs="+", metavar="HANDLE", help="Only these handles.")
    ap.add_argument("--limit", type=int, default=None, help="Only the first N linked players.")
    ap.add_argument("--season", default=DEFAULT_SEASON, help="tracker.gg season guid (default: V26 Act 4).")
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY_S, help="Seconds between page loads.")
    ap.add_argument("--overwrite", action="store_true", help="Re-capture handles that already have a screenshot.")
    ap.add_argument("--headful", action="store_true", help="Show the browser window (debugging).")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[FATAL] playwright not installed. Run:\n  pip install playwright\n"
              "  python -m playwright install chromium", file=sys.stderr)
        return 1

    targets = load_targets(args.handles, args.limit)
    if not targets:
        print("No matching linked accounts found.")
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    if not args.overwrite:
        before = len(targets)
        targets = [t for t in targets if not os.path.exists(os.path.join(OUT_DIR, f"{t[0]}.png"))]
        skipped = before - len(targets)
        if skipped:
            print(f"Skipping {skipped} handle(s) with an existing screenshot (use --overwrite to redo).")

    print(f"Capturing {len(targets)} profile(s) -> {OUT_DIR}")
    ok = missing = failed = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headful)
        page = browser.new_page(viewport=VIEWPORT)
        page.set_default_navigation_timeout(NAV_TIMEOUT_MS)

        for i, (handle, riot_id) in enumerate(targets, start=1):
            url = profile_url(riot_id, args.season)
            out_path = os.path.join(OUT_DIR, f"{handle}.png")
            try:
                page.goto(url, wait_until="domcontentloaded")
                try:
                    page.wait_for_selector(OVERVIEW_SELECTOR, timeout=12_000, state="visible")
                except Exception:
                    print(f"  [{i}/{len(targets)}] {handle}: no overview data for this season -- skipped")
                    missing += 1
                    time.sleep(args.delay)
                    continue
                # tracker.gg animates the giant-stat fill bars/numbers in on
                # load -- a screenshot taken immediately catches them
                # mid-animation (0-height bars, counting-up numbers).
                page.wait_for_timeout(1200)
                page.locator(OVERVIEW_SELECTOR).screenshot(path=out_path)
                print(f"  [{i}/{len(targets)}] {handle}: saved")
                ok += 1
            except Exception as e:  # noqa: BLE001 -- keep the batch going on one bad page
                print(f"  [{i}/{len(targets)}] {handle}: [error] {e}", file=sys.stderr)
                failed += 1
            time.sleep(args.delay)

        browser.close()

    print(f"\nDone. {ok} saved, {missing} with no data this season, {failed} failed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
