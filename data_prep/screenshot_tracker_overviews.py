r"""
Opens every linked tracker.gg profile (src/lib/trackerLinks.json) at the
Competitive Overview tab for one VALORANT Act, in YOUR OWN, ALREADY-RUNNING
local Firefox, and saves a screenshot of the window -- a real-world sample
to compare against this site's own player_act_stats.json numbers, since
tracker.gg publishes no API for this data (see fetch_act_stats.py's own
docstring for why the site's Ranked stats come from HenrikDev instead).

WHY THIS EXISTS -- NOT THE SAME THING AS THE PLAYWRIGHT VERSION
------------------------------------------------------------------
An earlier version of this script drove Firefox through Playwright, i.e.
the WebDriver/remote-debugging automation protocol. That gets Cloudflare-
challenged in a loop with NO way out, confirmed live -- even a human
manually solving the checkbox in that browser never clears it, because
Cloudflare is detecting the automation PROTOCOL connection itself
(`navigator.webdriver` and friends), not evaluating the checkbox click.
Patching that signal out (stealth plugins, patched builds) is real evasion
of the site's anti-bot measure and isn't something this script does.

This version is a genuinely different mechanism: it drives your real,
already-open Firefox purely through OS-level mouse/keyboard simulation
(`pyautogui`) -- typing a URL into the address bar and pressing Enter is
indistinguishable, to the browser and any page JS, from you doing it by
hand. There is no remote-debugging connection for a site to detect at all,
because none exists; this is the same category of tool as a macro
recorder, an accessibility input device, or RPA software.

SETUP
-----
    pip install pyautogui pygetwindow

Uninstall the old Playwright browser downloads if you no longer need them
for anything else in this repo:
    python -m playwright uninstall --all
    pip uninstall playwright

BEFORE RUNNING
--------------
  1. Open Firefox yourself (your real, normal browser -- not a special
     profile) and make sure it's the active/foreground window.
  2. Run with --warmup first (see below) so you can solve Cloudflare's
     challenge ONCE by hand if it appears. Since this is your real running
     Firefox, the resulting clearance cookie applies to every URL this
     script loads afterward in the same session -- you should not see the
     challenge again for the rest of the batch.
  3. This script steals keyboard/mouse focus while it runs (it's typing
     into your real browser) -- don't use the mouse/keyboard until it's
     done with the current page. `--delay` controls how long it waits
     between actions.
  4. Each handle opens in a NEW tab (Firefox's default when it's already
     running) and gets closed (Ctrl+W) right after its screenshot, so at
     most one extra tab is ever alive at once -- a 264-profile run would
     otherwise pile up 264 open tabs and eat RAM. --keep-tabs disables
     this if you want to leave a page open to inspect by hand.

CALIBRATING SCROLL + CAPTURE REGION
--------------------------------------
Without a debugging protocol, this script can't ask the page "where is the
overview card" the way the Playwright version could -- it can only scroll a
fixed amount and then crop a fixed pixel rectangle, both calibrated by eye
once and reused for the whole batch (every profile shares the same page
layout, so one calibration holds). Maximize Firefox, load any real profile
URL by hand, and:
  1. Scroll down with your own mouse wheel until the overview card is
     framed the way you want, counting roughly how many wheel clicks that
     took -- pass it as --scroll N.
  2. With the page scrolled to that position, note the on-screen pixel box
     around the card (Windows' own Snip & Sketch, Shift+Win+S, shows a
     live coordinate readout while you drag a selection) and pass it as
     --region x,y,width,height. Omitted, it screenshots the whole Firefox
     window at whatever scroll position --scroll left it at, and you crop
     afterward.

USAGE
-----
    python data_prep/screenshot_tracker_overviews.py --warmup --limit 1
    python data_prep/screenshot_tracker_overviews.py --scroll 6 --region 320,300,940,600
    python data_prep/screenshot_tracker_overviews.py --handles kozzy azury --region 320,300,940,600
    python data_prep/screenshot_tracker_overviews.py --season <guid> --delay 4

Screenshots land in data_prep/tracker_screenshots/{handle}.png (gitignored --
these are a local QA aid, not data the site ships). Re-running skips a
handle whose screenshot already exists unless --overwrite is passed, so an
interrupted batch resumes cheaply.
"""
import argparse
import json
import os
import shutil
import subprocess
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

# Common install locations, checked in order if --firefox-exe isn't given.
DEFAULT_FIREFOX_PATHS = [
    r"C:\Program Files\Mozilla Firefox\firefox.exe",
    r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
]

DEFAULT_DELAY_S = 4.0  # generous -- real page load, no DOM signal to wait on


def find_firefox_exe(explicit):
    if explicit:
        return explicit
    found = shutil.which("firefox")
    if found:
        return found
    for path in DEFAULT_FIREFOX_PATHS:
        if os.path.isfile(path):
            return path
    return None


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


def parse_region(s):
    try:
        x, y, w, h = (int(v) for v in s.split(","))
        return (x, y, w, h)
    except Exception:
        print(f"[FATAL] --region must be x,y,width,height (got {s!r})", file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--handles", nargs="+", metavar="HANDLE", help="Only these handles.")
    ap.add_argument("--limit", type=int, default=None, help="Only the first N linked players.")
    ap.add_argument("--season", default=DEFAULT_SEASON, help="tracker.gg season guid (default: V26 Act 4).")
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY_S, help="Seconds to wait after loading a URL.")
    ap.add_argument("--overwrite", action="store_true", help="Re-capture handles that already have a screenshot.")
    ap.add_argument("--firefox-exe", metavar="PATH", help="Path to firefox.exe (auto-detected otherwise).")
    ap.add_argument("--region", type=str, metavar="X,Y,W,H",
                    help="Fixed screen pixel rectangle to crop (see the module docstring's calibration section). "
                         "Omitted: screenshots the whole Firefox window.")
    ap.add_argument("--scroll", type=int, default=0,
                    help="Mouse-wheel clicks to scroll down after a page loads, before the screenshot -- the "
                         "overview card sits below the fold on tracker.gg's real layout. Same page shape every "
                         "profile, so one calibrated value should hold for the whole batch; 0 (default) scrolls "
                         "nothing. Negative pyautogui.scroll() convention is handled internally -- pass a plain "
                         "positive number for \"scroll down\".")
    ap.add_argument("--keep-tabs", action="store_true",
                    help="Don't close each tab after capturing it (default: close every tab right after its "
                         "screenshot, since open_url() opens a new one each time -- a long batch would otherwise "
                         "pile up one tab per handle and eat RAM). Only useful for debugging one page by hand.")
    ap.add_argument("--warmup", action="store_true",
                    help="Load the first target URL, then pause for you to press Enter in this terminal once "
                         "the page (and any Cloudflare challenge) has actually resolved, before starting the "
                         "timed batch. Strongly recommended for the very first run of a session.")
    args = ap.parse_args()

    try:
        import pyautogui
    except ImportError:
        print("[FATAL] pyautogui not installed. Run:\n  pip install pyautogui pygetwindow", file=sys.stderr)
        return 1
    try:
        import pygetwindow as gw
    except ImportError:
        gw = None  # window-finding is optional -- only needed for the default whole-window screenshot

    region = parse_region(args.region) if args.region else None

    firefox_exe = find_firefox_exe(args.firefox_exe)
    if not firefox_exe:
        print("[FATAL] Couldn't find firefox.exe. Pass --firefox-exe \"C:/path/to/firefox.exe\".", file=sys.stderr)
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
    if not targets:
        print("Nothing left to capture.")
        return 0

    def open_url(url):
        # Reuses your already-running Firefox (new tab in the same window,
        # same profile, same session) rather than launching a second
        # instance -- this is the exact `firefox.exe <url>` behaviour any
        # link click or "Open With Firefox" already relies on.
        subprocess.Popen([firefox_exe, url])

    def find_firefox_window():
        if gw is None:
            return None
        wins = [w for w in gw.getAllTitles() if "Mozilla Firefox" in w]
        return gw.getWindowsWithTitle(wins[0])[0] if wins else None

    def scroll_page():
        if not args.scroll:
            return
        win = find_firefox_window()
        # Scrolling happens wherever the mouse currently sits -- move it
        # into the page content first (a plain window-center point clears
        # tab bar/toolbar chrome on any normal Firefox layout), or fall
        # back to the screen center if the window can't be found.
        if win:
            cx, cy = win.left + win.width // 2, win.top + win.height // 2
        else:
            sw, sh = pyautogui.size()
            cx, cy = sw // 2, sh // 2
        pyautogui.moveTo(cx, cy)
        pyautogui.scroll(-abs(args.scroll))

    def capture(out_path):
        if region:
            img = pyautogui.screenshot(region=region)
        else:
            win = find_firefox_window()
            if win:
                img = pyautogui.screenshot(region=(win.left, win.top, win.width, win.height))
            else:
                img = pyautogui.screenshot()
        img.save(out_path)

    def close_tab():
        # Ctrl+W on the active tab -- since open_url() always opens a NEW
        # tab (Firefox's default remoting behaviour when it's already
        # running), doing this right after every capture keeps at most one
        # extra tab alive at a time instead of accumulating one per handle
        # across a 264-profile run. Firefox's own default on closing the
        # last tab is to replace it with a blank tab, not close the window,
        # so this can't accidentally end the session.
        win = find_firefox_window()
        if win:
            win.activate()
        pyautogui.hotkey("ctrl", "w")

    if args.warmup:
        handle, riot_id = targets[0]
        print(f"[warmup] Opening {handle}'s profile -- solve any Cloudflare challenge by hand, "
              f"confirm the real page has loaded, then press Enter here to continue.")
        open_url(profile_url(riot_id, args.season))
        input()
        if args.scroll:
            scroll_page()
        if not args.keep_tabs:
            close_tab()
            time.sleep(0.5)

    print(f"Capturing {len(targets)} profile(s) -> {OUT_DIR}")
    ok = failed = 0

    for i, (handle, riot_id) in enumerate(targets, start=1):
        out_path = os.path.join(OUT_DIR, f"{handle}.png")
        try:
            open_url(profile_url(riot_id, args.season))
            time.sleep(args.delay)
            scroll_page()
            time.sleep(0.5)  # let the scrolled layout settle before capturing
            capture(out_path)
            print(f"  [{i}/{len(targets)}] {handle}: saved")
            ok += 1
        except Exception as e:  # noqa: BLE001 -- keep the batch going on one bad page
            print(f"  [{i}/{len(targets)}] {handle}: [error] {e}", file=sys.stderr)
            failed += 1
        finally:
            # Close even on a failed capture -- a page that errored out is
            # exactly as much dead weight in RAM as one that succeeded, and
            # leaving it open just to inspect after the fact isn't worth
            # the accumulation risk this exists to avoid.
            if not args.keep_tabs:
                close_tab()
                time.sleep(0.5)

    print(f"\nDone. {ok} saved, {failed} failed. Spot-check a few -- this can't detect a "
          f"missed-data or still-loading page the way the old DOM-selector version could, "
          f"so a bad --delay just produces a wrong-looking screenshot rather than an error.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
