#!/usr/bin/env python3
"""
Fetch event/tournament logos (the small icon shown in tables and brackets,
not the "full" wordmark logo used as a tournament page's own header) from
Liquipedia's Valorant wiki, for the events this site has data for but no
logo yet -- currently the 25 Champions Tour 2023/2024 events added by the
historical backfill (`public/data/events.json` has 55 VCT events total;
`src/lib/eventLogos.json` already covers the 2025/2026 ones plus a handful
of Esports World Cup entries fetched separately -- see that file and
project-history for how those got there).

Same ToU-compliance approach as liquipedia_roster_scraper.py and
liquipedia_team_logos_scraper.py in this same directory: MediaWiki API
only, never the rendered HTML pages; custom User-Agent with contact info;
>=2s between requests; disk cache; CC-BY-SA 3.0 attribution.

WHY THIS READS THE INFOBOX DIRECTLY, UNLIKE THE TEAM LOGO SCRAPER
------------------------------------------------------------------
liquipedia_team_logos_scraper.py can't read a team's Infobox `image=`/
`imagedark=` fields -- those hold a different, larger "full" logo, and the
small icon shown everywhere a team appears only exists as the rendered
output of the {{Team|X}} template. Tournaments have no such split: a
League/Infobox's own `icon=`/`icondark=` fields ARE the small icon used in
tables and brackets (confirmed directly against several pages' wikitext --
`image=`/`imagedark=` there hold the "full" banner instead, exactly
mirroring the team split one level up, but the small one is a plain field
here rather than template-only output). So this script reads
action=query&prop=revisions directly, no action=parse rendering trick and
no 30s/request throttle -- a single ordinary action=query batches every
title's wikitext in one 2.5s-limited request.

Liquipedia page titles for these events don't follow one predictable
pattern -- confirmed by listing real pages (list=allpages) rather than
guessing, and title/icon fields differ by era:
  - 2023 regional splits are flat: "VCT/2023/Pacific League" (whose icon
    is exactly the file in this script's own example URL/naming).
  - 2024 regional splits nest under a stage: "VCT/2024/Pacific League/
    Stage 1". Americas/Pacific 2024 splits reuse their 2023 icon file
    outright (Liquipedia's own data, not a mistake here); EMEA 2024 has
    its own icon AND a genuine icondark variant (the only one of these 25
    that does); China 2024 shares one generic "VCT China" icon across all
    three of its 2024 splits.
  - Masters events use a shared generic "VCT Masters icon" regardless of
    host city; Champions events (2023 and 2024) share one generic
    "VCT Champions logo"; the 2023 Champions China Qualifier's page (a
    regional bracket, not yet a franchised league split that year) uses a
    generic "VCT Red logo" -- none of these three have a bracket/host-
    specific icon on Liquipedia at all, so there's nothing more distinctive
    to fetch for them.
NAME_TO_TITLE below is the result of that lookup, not a guess -- re-derive
it with list=allpages under "VCT/<year>" (see this repo's own scraping
notes/history) before assuming a new year's events follow the same shape.

USAGE
-----
  python3 liquipedia_event_logos_scraper.py --inspect "Champions Tour 2023 Pacific League"
      Dump one event's resolved icon filename(s). Run this first for any
      newly-added event name to confirm NAME_TO_TITLE resolves before a
      full run.

  python3 liquipedia_event_logos_scraper.py --out ../public/event-logos --map ../src/lib/eventLogos.json
      Fetch every event in NAME_TO_TITLE, download its icondark (falling
      back to icon) into --out, and merge local paths into --map. Existing
      entries not in NAME_TO_TITLE (2025/2026 events, EWC) are preserved.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import unquote

import requests

API = "https://liquipedia.net/valorant/api.php"

CONTACT = os.environ.get("LIQUIPEDIA_CONTACT", "")
USER_AGENT = (
    "vct-2026-data-analysis/1.0 "
    "(https://github.com/araise3/vct-2026-data-analysis; {contact})"
).format(contact=CONTACT)

REQUEST_DELAY = 2.5
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".liquipedia_event_logo_cache")

ATTRIBUTION = "Event logos from Liquipedia (liquipedia.net), licensed CC-BY-SA 3.0."

# Real render sizes of EventLogo across the site top out at size=28
# (Tournaments.jsx's accordion header); EventPicker uses 14/16. 75px
# thumbnails (the size used in this script's own reference URL) give
# >2.5x headroom over that with no local image processing -- Liquipedia's
# thumbnailing service generates the resize server-side via iiurlwidth.
THUMB_WIDTH = 75

# Our canonical event name (public/data/events.json's `name` field, exactly
# as stored -- this is what src/lib/eventLogos.json is keyed by, and what
# EventLogo.jsx looks values up by) -> the Liquipedia page title to query.
# Only the 25 events missing a logo as of this script's writing; see the
# module docstring for how these were found (list=allpages, not guessed).
NAME_TO_TITLE = {
    "Champions Tour 2023 LOCK//IN São Paulo": "VCT/2023/LOCK IN São Paulo",
    "Champions Tour 2023 Americas League": "VCT/2023/Americas League",
    "Champions Tour 2023 Emea League": "VCT/2023/EMEA League",
    "Champions Tour 2023 Pacific League": "VCT/2023/Pacific League",
    "Champions Tour 2023 Masters Tokyo": "VCT/2023/Masters",
    "Valorant Champions 2023": "VCT/2023/Champions",
    "Champions Tour 2023 Americas Last Chance Qualifier": "VCT/2023/Americas League/Last Chance Qualifier",
    "Champions Tour 2023 Emea Last Chance Qualifier": "VCT/2023/EMEA League/Last Chance Qualifier",
    "Champions Tour 2023 Pacific Last Chance Qualifier": "VCT/2023/Pacific League/Last Chance Qualifier",
    "Champions Tour 2023 Champions China Qualifier": "VCT/2023/China",
    "Champions Tour 2024 Masters Madrid": "VCT/2024/Stage 1/Masters",
    "Champions Tour 2024 Americas Kickoff": "VCT/2024/Americas League/Kickoff",
    "Champions Tour 2024 Pacific Kickoff": "VCT/2024/Pacific League/Kickoff",
    "Champions Tour 2024 Emea Kickoff": "VCT/2024/EMEA League/Kickoff",
    "Champions Tour 2024 China Kickoff": "VCT/2024/China League/Kickoff",
    "Champions Tour 2024 Emea Stage 1": "VCT/2024/EMEA League/Stage 1",
    "Champions Tour 2024 Masters Shanghai": "VCT/2024/Stage 2/Masters",
    "Champions Tour 2024 Pacific Stage 1": "VCT/2024/Pacific League/Stage 1",
    "Champions Tour 2024 Americas Stage 1": "VCT/2024/Americas League/Stage 1",
    "Champions Tour 2024 Pacific Stage 2": "VCT/2024/Pacific League/Stage 2",
    "Champions Tour 2024 China Stage 1": "VCT/2024/China League/Stage 1",
    "Champions Tour 2024 Emea Stage 2": "VCT/2024/EMEA League/Stage 2",
    "Champions Tour 2024 Americas Stage 2": "VCT/2024/Americas League/Stage 2",
    "Champions Tour 2024 China Stage 2": "VCT/2024/China League/Stage 2",
    "Valorant Champions 2024": "VCT/2024/Champions",
}


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    return s


def cache_path(kind, key):
    os.makedirs(CACHE_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)
    return os.path.join(CACHE_DIR, f"{kind}__{safe}.json")


def cached_get(s, kind, key, params):
    path = cache_path(kind, key)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    time.sleep(REQUEST_DELAY)
    r = s.get(API, params=params)
    r.raise_for_status()
    data = r.json()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return data


_ICON_FIELD_RE = re.compile(r"^\|(icon|icondark)=(.*)$")


def fetch_infobox_icons(s, titles):
    """One batched action=query&prop=revisions call for every title (no
    30s/request action=parse throttle needed here -- see module docstring
    for why tournaments don't need the template-render trick teams do).
    Returns {title: {"icon": name_or_None, "icondark": name_or_None}}."""
    digest = hashlib.md5("|".join(sorted(titles)).encode("utf-8")).hexdigest()
    data = cached_get(s, "eventwikitext", digest, {
        "action": "query", "format": "json", "titles": "|".join(titles),
        "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": "1",
    })
    redirect_map = {r["from"]: r["to"] for r in data["query"].get("redirects", [])}
    by_resolved_title = {}
    for page in data["query"]["pages"].values():
        resolved = page.get("title")
        fields = {"icon": None, "icondark": None}
        if "revisions" in page:
            content = page["revisions"][0]["slots"]["main"]["*"]
            for line in content.splitlines():
                m = _ICON_FIELD_RE.match(line.strip())
                if m:
                    fields[m.group(1)] = m.group(2).strip() or None
        by_resolved_title[resolved] = fields

    icons = {}
    for title in titles:
        resolved = redirect_map.get(title, title)
        icons[title] = by_resolved_title.get(resolved, {"icon": None, "icondark": None})
    return icons


def resolve_file_urls(s, filenames):
    """Batched imageinfo lookup, chunked to <=50 titles per request,
    requesting a pre-sized thumbnail (iiurlwidth) rather than the original
    -- same pattern as liquipedia_team_logos_scraper.py's own function."""
    urls = {}
    files = sorted(set(f for f in filenames if f))
    for i in range(0, len(files), 50):
        chunk = files[i:i + 50]
        titles = "|".join(f"File:{fn}" for fn in chunk)
        digest = hashlib.md5((titles + f"|w{THUMB_WIDTH}").encode("utf-8")).hexdigest()
        data = cached_get(s, "imageinfo", "chunk_" + digest, {
            "action": "query", "prop": "imageinfo", "iiprop": "url",
            "iiurlwidth": str(THUMB_WIDTH), "format": "json", "titles": titles,
        })
        pages = data.get("query", {}).get("pages", {})
        for pid, p in pages.items():
            title = p.get("title", "")
            fn = title[len("File:"):] if title.startswith("File:") else title
            if not p.get("imageinfo"):
                continue
            info = p["imageinfo"][0]
            urls[fn] = info.get("thumburl") or info["url"]
    return urls


def slugify(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect")
    ap.add_argument("--out", default=os.path.join("..", "public", "event-logos"))
    ap.add_argument("--map", default=os.path.join("..", "src", "lib", "eventLogos.json"))
    ap.add_argument("--events", nargs="*")
    args = ap.parse_args()

    if not CONTACT:
        print("[FATAL] Set LIQUIPEDIA_CONTACT before running.", file=sys.stderr)
        sys.exit(1)

    s = session()
    names = args.events or list(NAME_TO_TITLE.keys())
    titles = [NAME_TO_TITLE[n] for n in names]

    if args.inspect:
        title = NAME_TO_TITLE.get(args.inspect, args.inspect)
        fields = fetch_infobox_icons(s, [title])[title]
        print("icon:", fields["icon"])
        print("icondark:", fields["icondark"])
        return

    icons_by_title = fetch_infobox_icons(s, titles)
    per_event_files = {}
    missing = []
    for name, title in zip(names, titles):
        fields = icons_by_title.get(title, {})
        if not fields.get("icon") and not fields.get("icondark"):
            missing.append(name)
            continue
        per_event_files[name] = fields
        print(f"{name} ({title}): icon={fields.get('icon')} icondark={fields.get('icondark')}")

    if missing:
        print("\n[warn] no icon/icondark field found for:", missing)

    all_filenames = [
        fn for fields in per_event_files.values()
        for fn in (fields.get("icon"), fields.get("icondark")) if fn
    ]
    url_map = resolve_file_urls(s, all_filenames)

    os.makedirs(args.out, exist_ok=True)

    if os.path.exists(args.map):
        with open(args.map, encoding="utf-8") as f:
            logos = json.load(f)
    else:
        logos = {}

    dl_session = session()
    downloaded = 0
    for name, fields in per_event_files.items():
        dark, light = fields.get("icondark"), fields.get("icon")
        chosen = dark or light
        if not chosen or chosen not in url_map:
            print(f"[warn] no resolvable image for {name} (icon={light}, icondark={dark})")
            continue
        url = url_map[chosen]
        ext = os.path.splitext(chosen)[1] or ".png"
        local_name = f"{slugify(name)}{ext}"
        local_path = os.path.join(args.out, local_name)
        time.sleep(REQUEST_DELAY)
        r = dl_session.get(url)
        r.raise_for_status()
        with open(local_path, "wb") as f:
            f.write(r.content)
        logos[name] = f"/event-logos/{local_name}"
        downloaded += 1
        print(f"downloaded {name} -> {local_path} ({'icondark' if dark and chosen == dark else 'icon'})")

    with open(args.map, "w", encoding="utf-8") as f:
        json.dump(logos, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\n{ATTRIBUTION}")
    print(f"Wrote {downloaded}/{len(per_event_files)} logos to {args.out}, updated {args.map}")


if __name__ == "__main__":
    main()
