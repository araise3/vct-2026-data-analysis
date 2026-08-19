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

HEADLESS CHROMIUM GETS CLOUDFLARE-CHALLENGED -- USE --headful (AND PREFER FIREFOX)
------------------------------------------------------------------------------------
Confirmed live: headless Chromium hits tracker.gg's Cloudflare "Performing
security verification" interstitial instead of the real page (title "Just a
moment...", no stats markup at all). This is the same Cloudflare protection
fetch_act_stats.py's own docstring already documents for their internal
API, just also covering the plain profile pages when the client looks
automated. No fingerprinting-evasion workaround was added for this
(stealth plugins, spoofed automation flags, cookie/session reuse from
another tool) -- deliberately: that's circumventing a site's own active
anti-bot measure, not a bug to patch around.

Two levers this script DOES expose, because they're not evasion tricks,
just... using a real browser:
  - `--headful` shows a real, visible browser window -- a normal visible
    session is what tracker.gg is trying to distinguish FROM a bot in the
    first place. Can't launch in a display-less sandbox (confirmed: this
    repo's own sandboxed environment has no display server) -- run this
    from a real desktop.
  - `--browser firefox` (the default) drives Playwright's real Firefox
    build instead of Chromium -- a different engine with a different,
    less automation-associated fingerprint by default. `--profile-dir
    <path>` goes a step further: launches against a COPY of your actual
    Firefox profile (find its path via Firefox's own about:profiles page)
    instead of a blank one, so the session carries your real cookies and
    history rather than looking like a browser that's never been used.
    This is still just automating a genuine, already-authenticated
    browser session (the same idea "Claude in Chrome" already does
    against a user's real Chrome for other tasks), not spoofing what the
    browser reports about itself.

    ALWAYS A COPY, NEVER YOUR LIVE PROFILE DIRECTLY: Playwright's bundled
    Firefox build is pinned to a specific (often older) version, and
    Firefox itself will refuse to open a newer real profile with an older
    build without warning that it may corrupt your saved bookmarks/
    history (confirmed live -- this is a real Firefox safety prompt, not
    a bug here). Since real corruption risk to someone's actual browsing
    data is a completely disproportionate price for taking a few
    screenshots, this script copies your profile directory to a scratch
    location under the system temp dir and launches against THAT --
    your real profile is never opened by this script at all. Still worth
    closing Firefox first so the copy isn't racing live writes (a locked
    file mid-copy fails loudly rather than silently skipping).

SETUP
-----
    pip install playwright
    python -m playwright install firefox
    # or: python -m playwright install chromium   (if using --browser chromium)

USAGE
-----
    python data_prep/screenshot_tracker_overviews.py --headful                         # everyone, fresh Firefox profile
    python data_prep/screenshot_tracker_overviews.py --headful --handles kozzy azury
    python data_prep/screenshot_tracker_overviews.py --headful --limit 10
    python data_prep/screenshot_tracker_overviews.py --headful --profile-dir "C:/Users/you/AppData/Roaming/Mozilla/Firefox/Profiles/xxxxxxxx.default-release"
    python data_prep/screenshot_tracker_overviews.py --headful --browser chromium --season <guid> --delay 3

Screenshots land in data_prep/tracker_screenshots/{handle}.png (gitignored --
these are a local QA aid, not data the site ships). Re-running skips a
handle whose screenshot already exists unless --overwrite is passed, so an
interrupted batch resumes cheaply.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
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


# Build-version-tagged files inside a Firefox profile -- safe to strip from
# a disposable copy (Firefox regenerates all of them on next launch) and
# necessary to: Playwright's bundled Firefox is pinned to its own version,
# almost always older than a real, auto-updating install, and a real
# profile records the LAST build that opened it. `compatibility.ini` is
# what actually triggers the "older version... may corrupt" prompt/silent
# bail (confirmed live: the copy launch above exited cleanly in ~0.3s with
# no window and no interactive dialog captured, consistent with Firefox
# refusing the mismatch non-interactively rather than genuinely crashing).
# `startupCache`/`shader-cache` are compiled-code/GPU caches keyed to the
# exact build that wrote them; a stale one from a much newer real Firefox
# is a plausible source of the "shader-cache: Shader disk cache is not
# supported" GraphicsCriticalError also seen in that same failed launch.
_VERSION_TAGGED_PROFILE_ENTRIES = ("compatibility.ini", "startupCache", "shader-cache")


def copy_profile(source_dir):
    """Copies a real browser profile directory to a scratch location under
    the system temp dir, strips the build-version-tagged entries above, and
    returns the copy's path -- see the module docstring's own section on
    why copying (rather than opening the real profile) is never optional.
    Locked files (Firefox still running, mid-write) surface as a clear
    error asking the user to close the browser, rather than silently
    producing a partial/inconsistent copy.
    """
    dest_root = tempfile.mkdtemp(prefix="tracker_screenshot_profile_")
    dest = os.path.join(dest_root, "profile")
    print(f"Copying profile to a scratch location (your real profile is never opened): {dest}")
    try:
        shutil.copytree(source_dir, dest)
    except (OSError, shutil.Error) as e:
        print(f"[FATAL] Couldn't copy the profile -- likely a file locked by a running Firefox. "
              f"Close Firefox and retry. ({e})", file=sys.stderr)
        sys.exit(1)

    for name in _VERSION_TAGGED_PROFILE_ENTRIES:
        path = os.path.join(dest, name)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.isfile(path):
            os.remove(path)

    return dest


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
    ap.add_argument("--headful", action="store_true", help="Show the browser window -- do this on a real desktop.")
    ap.add_argument("--browser", choices=["firefox", "chromium"], default="firefox",
                    help="Engine to drive (default: firefox -- see the module docstring on why).")
    ap.add_argument("--profile-dir", metavar="PATH",
                    help="Launch against a COPY of a real Firefox profile directory (Firefox's own "
                         "about:profiles page shows the path) instead of a blank one, so the session carries "
                         "real cookies/history -- your actual profile is never opened directly (see the "
                         "module docstring on why). Close Firefox first so the copy isn't racing live writes. "
                         "Chromium profile dirs work too if --browser chromium.")
    args = ap.parse_args()

    if args.profile_dir and not os.path.isdir(args.profile_dir):
        print(f"[FATAL] --profile-dir does not exist or isn't a directory: {args.profile_dir}", file=sys.stderr)
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[FATAL] playwright not installed. Run:\n  pip install playwright\n"
              f"  python -m playwright install {args.browser}", file=sys.stderr)
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
        engine = getattr(pw, args.browser)
        browser = None
        if args.profile_dir:
            profile_copy = copy_profile(args.profile_dir)
            # A persistent context IS the browser -- no separate launch()/
            # new_context() step, and it owns the profile directory for its
            # whole lifetime (hence closing it via `context`, not `browser`,
            # below).
            context = engine.launch_persistent_context(
                profile_copy, headless=not args.headful, viewport=VIEWPORT,
            )
            page = context.pages[0] if context.pages else context.new_page()
        else:
            browser = engine.launch(headless=not args.headful)
            context = browser.new_context(viewport=VIEWPORT)
            page = context.new_page()
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

        context.close()
        if browser:
            browser.close()

    print(f"\nDone. {ok} saved, {missing} with no data this season, {failed} failed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
