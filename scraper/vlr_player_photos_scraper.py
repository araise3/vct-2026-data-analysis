#!/usr/bin/env python3
"""
Downloads player portraits from VLR.gg for every player this site tracks,
into public/player_photos/{handle}.png, plus a lookup manifest at
public/data/player_photos.json ({handleLower: "player_photos/{handle}.png"})
for PlayerProfile.jsx to use in place of its SVG placeholder header icon.

WHY VLR, NOT LIQUIPEDIA
------------------------
Liquipedia's own infobox `image` field looked like the natural fit (this
site already scrapes Liquipedia for names/birthdates/rosters), but checked
directly against the live wiki and it's the wrong source: those images are
tournament-photography stills (filenames like "TenZ at Masters Madrid
2024.jpg" -- a wide shot of the player mid-match, not a portrait), framed
inconsistently player to player, AND licensed "(c) Riot Games, Used With
Permission" on Liquipedia specifically -- not the CC-BY-SA 3.0 this project
already relies on for roster/name text data. Wrong fit on both framing
consistency and reuse rights.

VLR.gg's own player pages carry a real headshot-style avatar for a good
share of players (hosted on VLR's own owcdn.net CDN), falling back to a
shared placeholder silhouette (/img/base/ph/sil.png) for anyone without
one -- confirmed live against both a real photo and a real placeholder.
Same site this project's entire primary data pipeline already treats as
its source of truth (vlr_vct_scraper.py etc.), so no new trust decision.

HOW A HANDLE MAPS TO A VLR PLAYER -- DIRECT LINKS, NOT SEARCH
----------------------------------------------------------------
An earlier version of this script resolved each handle via VLR's own player
search (`/search/?q={handle}&type=players`) -- workable, but search returns
fuzzy/substring matches too (searching "heat" also surfaces "Heather",
"heat2k", "heatwave", ...), and the search result row carries no team or
country to disambiguate an exact-name collision between two different real
players with. Replaced with the DIRECT link instead: `export_from_db.py`
now exports public/data/player_urls.json, sourced from
player_event_stats.player_url -- an actual <a href> the main scraper
already followed while scraping each event's /event/stats/ page, not a
guess. No ambiguity left to resolve at all: a handle either has a real,
specific VLR profile URL on file or it doesn't.

USAGE
-----
    python3 scraper/vlr_player_photos_scraper.py
    python3 scraper/vlr_player_photos_scraper.py --inspect chubizin TenZ
    python3 scraper/vlr_player_photos_scraper.py --limit 20     # smoke test

Reads every handle from ../public/data/player_buckets.json's own `meta`
(this site's full known-player list, current roster or not), and for each
one looks up its direct profile URL in ../public/data/player_urls.json.
A handle with no entry there (never appeared in a player_event_stats row --
e.g. too new, or only ever scraped into map_player_stats which carries no
url column) is skipped as "no direct link on file" rather than falling
back to a search; re-running this script after a future export picks it up
automatically once export_from_db.py has a link for it.

Writes:
  - public/player_photos/{handle}.png -- the actual downloaded image,
    handle lowercased, served from this site's own origin rather than
    hotlinked from VLR's CDN at runtime (same reasoning as
    download_flags.py / liquipedia_team_logos_scraper.py: fetch once,
    serve locally forever after).
  - public/data/player_photos.json, {handleLower: "player_photos/{handle}.png"}
    -- only for handles that actually resolved to a real (non-placeholder)
    photo. A handle simply absent from this file means "no known photo";
    PlayerProfile.jsx keeps showing its existing SVG placeholder for that
    case, same as any other not-yet-covered player.

Point-in-time snapshot, not a live fetch, same tradeoff every other image
asset in this pipeline already makes (team logos, flags, event logos): a
player who gets a fresh VLR photo later needs this re-run, not a runtime
fallback. Re-running only fetches handles with no local photo file yet,
same skip-if-present behavior as download_flags.py -- pass --refresh to
re-check everyone anyway (e.g. after a batch of known renames/new photos).

NOTES
-----
This is intentionally polite, same posture as vlr_vct_scraper.py: ~1.5s
delay between requests, retries with backoff, a real User-Agent, and it
only hits vlr.gg. Run this on YOUR machine / environment with normal
internet access -- it will NOT run inside this sandboxed chat, which
can't reach vlr.gg. Also needs public/data/player_urls.json to already
exist -- run/commit a fresh export_from_db.py pass first if it doesn't.
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.vlr.gg"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
        "vlr-vct-2026-research-scraper/1.0"
    )
}
REQUEST_DELAY = (1.2, 2.2)  # random delay range (seconds) between requests
MAX_RETRIES = 4
BLOCK_STATUSES = (401, 403, 429)
PLACEHOLDER_MARKER = "/img/base/ph/sil.png"
# The player header's own avatar image -- confirmed against the live DOM
# (not just a lossy HTML-to-markdown fetch) on both a player with a real
# photo and one on the placeholder: <div class="wf-avatar mod-player">
# <img src="..."></div>. Deliberately NOT a bare "img" selector -- the rest
# of a player page has plenty of other images (team logos, agent icons,
# flags) this must not accidentally match.
AVATAR_SELECTOR = "div.wf-avatar.mod-player img"

HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(HERE)
PLAYER_BUCKETS_PATH = os.path.join(_REPO_ROOT, "public", "data", "player_buckets.json")
PLAYER_URLS_PATH = os.path.join(_REPO_ROOT, "public", "data", "player_urls.json")
PHOTOS_DIR = os.path.join(_REPO_ROOT, "public", "player_photos")
MANIFEST_PATH = os.path.join(_REPO_ROOT, "public", "data", "player_photos.json")
MANIFEST_PREFIX = "player_photos/"  # relative to public/, matches how teamLogos.json etc. are consumed


class ScrapeFailure(Exception):
    """vlr.gg is refusing this client outright (401/403/429) -- retrying or
    continuing would just burn requests for the same result. Same class of
    abort vlr_vct_scraper.py raises for the identical reason."""


def fetch(session, url):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, headers=HEADERS, timeout=20)
            if resp.status_code == 200:
                time.sleep(random.uniform(*REQUEST_DELAY))
                return resp
            if resp.status_code == 404:
                return None
            if resp.status_code in BLOCK_STATUSES:
                raise ScrapeFailure(
                    f"HTTP {resp.status_code} from {url} -- vlr.gg is refusing this client. "
                    f"Aborting rather than continuing with incomplete data."
                )
            print(f"  [{resp.status_code}] {url} (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {url}: {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    print(f"  [FAILED after {MAX_RETRIES} attempts] {url}")
    return None


def resolve_player(session, url):
    """Fetches `url` (a direct VLR player-page link from player_urls.json)
    and returns (photo_url_or_None, status). status is "ok" whether or not
    a real photo was found -- None just means "resolved this player, but
    they only have the shared placeholder on file", a real (if rare) case
    distinct from the page failing to load at all."""
    resp = fetch(session, url)
    if resp is None:
        return None, "fetch_failed"

    soup = BeautifulSoup(resp.text, "html.parser")
    img = soup.select_one(AVATAR_SELECTOR)
    src = img.get("src") if img else None
    if not src or PLACEHOLDER_MARKER in src:
        return None, "ok"  # real page, just no photo on file

    if src.startswith("//"):
        src = "https:" + src
    elif src.startswith("/"):
        src = BASE + src
    return src, "ok"


def load_handles():
    with open(PLAYER_BUCKETS_PATH, encoding="utf-8") as f:
        return sorted(json.load(f)["meta"].keys())


def load_player_urls():
    if not os.path.exists(PLAYER_URLS_PATH):
        print(
            f"[FATAL] {PLAYER_URLS_PATH} not found -- run a fresh export_from_db.py pass first "
            f"(it now writes this file; see export_from_db.py's own 'direct VLR player links' comment).",
            file=sys.stderr,
        )
        sys.exit(1)
    with open(PLAYER_URLS_PATH, encoding="utf-8") as f:
        return json.load(f)


def download_photo(session, handle, photo_url):
    resp = fetch(session, photo_url)
    if resp is None:
        return False
    ext = os.path.splitext(urllib.parse.urlparse(photo_url).path)[1] or ".png"
    out_path = os.path.join(PHOTOS_DIR, f"{handle.lower()}{ext}")
    with open(out_path, "wb") as f:
        f.write(resp.content)
    return f"{MANIFEST_PREFIX}{handle.lower()}{ext}"


def load_manifest():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(manifest):
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", nargs="+", metavar="HANDLE",
                     help="Resolve a few handles and print the result, no write.")
    ap.add_argument("--limit", type=int, default=None,
                     help="Only process the first N handles (smoke test).")
    ap.add_argument("--refresh", action="store_true",
                     help="Re-check every handle, including ones with a photo file already on disk.")
    args = ap.parse_args()

    session = requests.Session()
    player_urls = load_player_urls()

    if args.inspect:
        for handle in args.inspect:
            url = player_urls.get(handle.lower())
            if not url:
                print(f"{handle}: no direct link on file in player_urls.json")
                continue
            photo_url, status = resolve_player(session, url)
            print(f"{handle}: url={url} status={status} photo_url={photo_url!r}")
        return 0

    handles = load_handles()
    if args.limit:
        handles = handles[:args.limit]

    manifest = load_manifest()
    os.makedirs(PHOTOS_DIR, exist_ok=True)

    already_covered = 0
    if not args.refresh:
        # Skip handles that already have a manifest entry AND a photo file
        # still on disk -- consistent with download_flags.py's own
        # skip-if-present behavior, so a re-run only spends requests on
        # what's actually missing.
        skip = set()
        for h in handles:
            entry = manifest.get(h.lower())
            if entry and os.path.exists(os.path.join(_REPO_ROOT, "public", entry)):
                skip.add(h)
        already_covered = len(skip)
        handles = [h for h in handles if h not in skip]

    print(f"Resolving {len(handles)} handle(s) ({already_covered} already covered, skipped).")

    found, no_photo, no_url, fetch_failed, failed = 0, 0, 0, 0, 0
    try:
        for i, handle in enumerate(handles, start=1):
            if i % 25 == 0 or i == len(handles):
                print(f"  ...{i}/{len(handles)}")
            url = player_urls.get(handle.lower())
            if not url:
                no_url += 1
                continue
            photo_url, status = resolve_player(session, url)
            if status == "fetch_failed":
                fetch_failed += 1
                continue
            # status == "ok"
            if photo_url is None:
                no_photo += 1
                continue
            rel_path = download_photo(session, handle, photo_url)
            if rel_path:
                manifest[handle.lower()] = rel_path
                found += 1
            else:
                failed += 1
    except ScrapeFailure as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        save_manifest(manifest)  # keep whatever was already fetched this run
        return 2

    save_manifest(manifest)
    print(
        f"\nDone. {found} photo(s) fetched, {no_photo} resolved with no photo on file, "
        f"{no_url} handle(s) with no direct link on file, {fetch_failed} page-fetch failure(s), "
        f"{failed} download failure(s)."
    )
    print(f"{len(manifest)} total players covered in {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
