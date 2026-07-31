#!/usr/bin/env python3
"""
Fetch team logos (the "darkmode" variant, meant to sit directly on a dark
background with no white box) from Liquipedia's Valorant wiki, for every
team that appears anywhere in this site's data -- not just the current VCT
2026 franchise lineup, since historical team pages (TeamProfile.jsx) need a
logo too.

Same ToU-compliance approach as liquipedia_roster_scraper.py in this same
directory (read that file's docstring for the full rationale): MediaWiki
API only, never the rendered HTML pages; custom User-Agent with contact
info; >=2s between requests; disk cache; CC-BY-SA 3.0 attribution.

WHY THIS RENDERS {{Team|X}} INSTEAD OF READING THE INFOBOX
------------------------------------------------------------
An earlier version of this script read each team's own page Infobox
(action=query&prop=revisions) for its `image=`/`imagedark=` fields. That
was wrong: those fields hold the "full" wordmark logo used as that team's
own page header (e.g. "100 Thieves full darkmode.png"), a *different,
larger* asset from the small square icon actually shown everywhere else on
Liquipedia a team appears -- in the Partnered Teams tables, brackets, etc.
That small icon isn't stored as a plain wikitext field anywhere; it only
exists as the {{Team|X}} template's rendered output (backed by a separate
per-team data source, not the Infobox). So this fetches it the only way
possible: action=parse on a wikitext string built out of every team's
{{Team|X}} call at once (all ~55 fit in a single response, confirmed --
the preprocessor's node-count limit isn't remotely close), then parses the
returned HTML for each team's icon <img src>, preferring the darkmode
variant. A second, batched action=query&prop=imageinfo pass (up to 50
titles/request) resolves those filenames to actual downloadable URLs --
neither the wikitext nor the rendered HTML's thumbnail URL is a fetchable
full-resolution file on its own.

action=parse is rate-limited to 1 request/30s (vs. 1/2s for a plain
query), which is exactly why batching every team into one call matters --
one call for all ~55 teams costs the same 30s as one call for a single
team would.

USAGE
-----
  python3 liquipedia_team_logos_scraper.py --inspect "100 Thieves"
      Dump one team's rendered dark/light icon filenames. Run this first
      for any newly-added team name to confirm it resolves before a full
      run.

  python3 liquipedia_team_logos_scraper.py --out ../public/logos --map ../src/lib/teamLogos.json
      Fetch every team in TEAM_NAME_MAP, download its darkmode (falling
      back to lightmode) icon into --out, and rewrite --map with local
      paths + tags. Existing entries not in TEAM_NAME_MAP are preserved.
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
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".liquipedia_logo_cache")

ATTRIBUTION = "Team logos from Liquipedia (liquipedia.net), licensed CC-BY-SA 3.0."

# Our canonical team name (as stored in public/data/*.json and
# src/lib/teamLogos.json) -> the Liquipedia page title to query. Only
# listed where they differ; identical names are handled by falling back to
# the key itself (see resolve_title()).
TEAM_NAME_MAP = {
    "100 Thieves": "100 Thieves",
    "2Game Esports": "2GAME Esports",
    "All Gamers": "All Gamers",
    "Apeks": "Apeks",
    "BBL Esports": "BBL Esports",
    "BOOM Esports": "BOOM Esports",
    "Bilibili Gaming": "Bilibili Gaming",
    "Cloud9": "Cloud9",
    "DetonatioN FocusMe": "DetonatioN FocusMe",
    "Dragon Ranger Gaming": "Dragon Ranger Gaming",
    "EDward Gaming": "EDward Gaming",
    "ENVY": "ENVY",
    "Eternal Fire": "Eternal Fire",
    "Evil Geniuses": "Evil Geniuses",
    "FNATIC": "Fnatic",
    "FULL SENSE": "FULL SENSE",
    "FURIA": "FURIA",
    "FUT Esports": "FUT Esports",
    "FunPlus Phoenix": "FunPlus Phoenix",
    "G2 Esports": "G2 Esports",
    "GIANTX": "GIANTX",
    "Gen.G": "Gen.G Esports",
    "Gentle Mates": "Gentle Mates",
    "Global Esports": "Global Esports",
    "JDG Esports": "JD Gaming",
    "KIWOOM DRX": "DRX",
    "KOI": "KOI",
    "KRÜ Esports": "KRÜ Esports",
    "Karmine Corp": "Karmine Corp",
    "KeepBest Gaming": "KeepBest Gaming",
    "LEVIATÁN": "Leviatán",
    "LOUD": "LOUD",
    "MIBR": "MIBR",
    "NRG": "NRG",
    "Natus Vincere": "Natus Vincere",
    "Nongshim RedForce": "Nongshim RedForce",
    "Nova Esports": "Nova Esports",
    "PCIFIC Esports": "PCIFIC Esports",
    "Paper Rex": "Paper Rex",
    "Rex Regum Qeon": "Rex Regum Qeon",
    "Sentinels": "Sentinels",
    "T1": "T1",
    "TALON": "TALON",
    "TYLOO": "TYLOO",
    "Team Heretics": "Team Heretics",
    "Team Liquid": "Team Liquid",
    "Team Secret": "Team Secret",
    "Team Vitality": "Team Vitality",
    "Titan Esports Club": "Titan Esports Club",
    "Trace Esports": "Trace Esports",
    "VARREL": "VARREL",
    "Wolves Esports": "Wolves Esports",
    "Xi Lai Gaming": "XLG Esports",
    "ZETA DIVISION": "ZETA DIVISION",
    "A Team": "A Team",
}

# Tags already known (kept from the previous src/lib/teamLogos.json where
# present) -- Liquipedia's infobox doesn't carry a short in-game tag, so
# this has to come from somewhere else. Filled in for every team above;
# unresolved teams fall back to their own name.
TAGS = {
    "100 Thieves": "100T", "2Game Esports": "2GE", "All Gamers": "AG",
    "Apeks": "APK", "BBL Esports": "BBL", "BOOM Esports": "BOOM",
    "Bilibili Gaming": "BLG", "Cloud9": "C9", "DetonatioN FocusMe": "DFM",
    "Dragon Ranger Gaming": "DRG", "EDward Gaming": "EDG", "ENVY": "ENVY",
    "Eternal Fire": "EF", "Evil Geniuses": "EG", "FNATIC": "FNC",
    "FULL SENSE": "FS", "FURIA": "FUR", "FUT Esports": "FUT",
    "FunPlus Phoenix": "FPX", "G2 Esports": "G2", "GIANTX": "GX",
    "Gen.G": "GEN", "Gentle Mates": "M8", "Global Esports": "GE",
    "JDG Esports": "JDG", "KIWOOM DRX": "DRX", "KOI": "KOI",
    "KRÜ Esports": "KRÜ", "Karmine Corp": "KC", "KeepBest Gaming": "KB",
    "LEVIATÁN": "LEV", "LOUD": "LOUD", "MIBR": "MIBR", "NRG": "NRG",
    "Natus Vincere": "NAVI", "Nongshim RedForce": "NS", "Nova Esports": "NOVA",
    "PCIFIC Esports": "PCF", "Paper Rex": "PRX", "Rex Regum Qeon": "RRQ",
    "Sentinels": "SEN", "T1": "T1", "TALON": "TLN", "TYLOO": "TYL",
    "Team Heretics": "TH", "Team Liquid": "TL", "Team Secret": "TS",
    "Team Vitality": "VIT", "Titan Esports Club": "TEC", "Trace Esports": "TE",
    "VARREL": "VL", "Wolves Esports": "WOL", "Xi Lai Gaming": "XLG",
    "ZETA DIVISION": "ZETA", "A Team": "AT",
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


def thumb_url_to_filename(url):
    """"/commons/images/thumb/7/78/100_Thieves_darkmode.png/64px-100_Thieves_darkmode.png"
    -> "100 Thieves darkmode.png". Thumb URLs are always
    /thumb/<hash1>/<hash2>/<filename>/<size>-<filename>; the filename is the
    second-to-last path segment, not the last (which is a resized copy).

    Two normalizations, both required for resolve_file_urls()'s later
    dict lookup to actually hit: the path segment is URL-encoded (confirmed
    on LEVIATAN's icon: literal "%C3%A1" for a) so it needs unquoting, and
    it uses underscores where the real MediaWiki file title uses spaces --
    the imageinfo API silently *accepts* either and normalizes to spaces in
    its response (confirmed directly), but doesn't normalize back, so a
    dict keyed by the API's returned (space) title never matched a lookup
    using the underscore form and every single title "failed to resolve"."""
    if url is None:
        return None
    parts = url.rstrip("/").split("/")
    if len(parts) < 2:
        return None
    return unquote(parts[-2]).replace("_", " ")


def fetch_team_icons(s, titles):
    """Renders every {{Team|X}} in one batched action=parse call (rather
    than one page-content fetch per team) and extracts each team's small
    icon filename -- NOT the team page's own Infobox image/imagedark, which
    is a different, larger "full" logo (e.g. "100 Thieves full darkmode.png")
    meant for that team's own page header. The small icon actually used
    everywhere a team appears in a table/bracket (matching what this site's
    TeamLogo component needs) only exists as this template's rendered
    output -- it isn't stored as a plain wikitext field anywhere, confirmed
    by inspecting the rendered HTML directly and finding filenames like
    "100_Thieves_darkmode.png" with no "full" in them.

    Batching all teams into a single parse call (rather than one per team)
    matters because action=parse is rate-limited to 1 request/30s, 15x
    slower than a plain query -- confirmed via a real run that 55 teams
    render together in one ~46KB response with the preprocessor nowhere
    near its node-count limit, so there's no need to chunk this at all.

    Returns {team_name: (dark_filename_or_None, light_filename_or_None)}.
    """
    text = "\n".join(f"{{{{Team|{t}}}}}" for t in titles)
    digest = hashlib.md5(text.encode("utf-8")).hexdigest()
    path = cache_path("teamicons", digest)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            html = json.load(f)["html"]
    else:
        time.sleep(30)  # action=parse is limited to 1 req/30s, not 1/2s
        r = s.post(API, data={
            "action": "parse", "text": text, "contentmodel": "wikitext", "format": "json",
        })
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"parse error: {data['error']}")
        html = data["parse"]["text"]["*"]
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"html": html}, f)

    # Split on each team's opening marker span rather than trying to match
    # a whole block with a lookahead for "the next span or end of string" --
    # that lookahead approach silently failed to capture the very last team
    # in the list (confirmed: 54/55 found, the missing one always being
    # whichever title happened to be last), since backtracking a non-greedy
    # `.*?</span>` against arbitrary nested spans is fragile right at the
    # true end of the string. Splitting is simpler and has no such edge case.
    parts = re.split(
        r'(?=<span data-highlightingclass="[^"]+" class="team-template-team-standard">)',
        html,
    )
    icons = {}
    for part in parts:
        m = re.match(r'<span data-highlightingclass="([^"]+)" class="team-template-team-standard">', part)
        if not m:
            continue
        name = m.group(1)
        dark = re.search(r'darkmode"[^>]*>.*?src="([^"]+)"', part, re.S)
        light = re.search(r'lightmode"[^>]*>.*?src="([^"]+)"', part, re.S)
        single = re.search(r'team-template-image-icon"[^>]*>.*?src="([^"]+)"', part, re.S)
        dark_fn = thumb_url_to_filename(dark.group(1)) if dark else None
        light_fn = thumb_url_to_filename(light.group(1)) if light else thumb_url_to_filename(single.group(1)) if single else None
        icons[name] = (dark_fn, light_fn)
    return icons


# Every real usage of TeamLogo across the site tops out at size=44
# (TeamProfile's header). Requesting a 160px-wide thumbnail instead of the
# original covers that up to ~3.6x device pixel ratio with headroom to
# spare, at a fraction of the size -- the originals turned out to be huge
# (some team logos are scanned/exported at 3000px on the long edge, one as
# large as 5.4MB for a single file) despite never being displayed above
# 44px anywhere, which was the actual performance problem: ~25MB of image
# weight for icons rendered at 18-44px.
THUMB_WIDTH = 160


def resolve_file_urls(s, filenames):
    """Batched imageinfo lookup, chunked to <=50 titles per request.
    Requests a pre-sized thumbnail (iiurlwidth) rather than the original
    full-resolution file -- Liquipedia's thumbnailing service generates
    this server-side, so no local image processing is needed."""
    urls = {}
    files = sorted(set(filenames))
    for i in range(0, len(files), 50):
        chunk = files[i:i + 50]
        titles = "|".join(f"File:{fn}" for fn in chunk)
        # Python's builtin hash() is randomized per-process (PYTHONHASHSEED)
        # for str inputs, so it can't be used as a stable cache-file key
        # across runs -- md5 gives the same key every time for the same
        # chunk of titles, so a re-run actually hits the cache instead of
        # silently re-requesting (and burning another round of rate-limited
        # calls) every single time.
        digest = hashlib.md5((titles + f"|w{THUMB_WIDTH}").encode("utf-8")).hexdigest()
        data = cached_get(s, "imageinfo", "chunk_" + digest, {
            "action": "query", "prop": "imageinfo", "iiprop": "url",
            "iiurlwidth": str(THUMB_WIDTH), "format": "json", "titles": titles,
        })
        pages = data.get("query", {}).get("pages", {})
        for pid, p in pages.items():
            title = p.get("title", "")
            fn = title[len("File:"):] if title.startswith("File:") else title
            # Files living on Liquipedia's shared "lpcommons" media repo
            # (imagerepository != local, true for nearly every team logo)
            # carry "missing":"" on the *local*-wiki page check even though
            # imageinfo/url is fully populated -- confirmed directly against
            # the API (100 Thieves' darkmode file returns both at once). Only
            # actually-absent files lack imageinfo entirely, so that's the
            # real signal, not the "missing" key.
            if not p.get("imageinfo"):
                continue
            info = p["imageinfo"][0]
            # thumburl is only present when the source is actually wider
            # than THUMB_WIDTH and thumbnailing applies; a handful of team
            # icons are already narrower than 160px (e.g. KOI's is 649px --
            # not tiny, but some could legitimately be under the threshold),
            # in which case there's no separate thumbnail and the original
            # *is* the appropriately-sized file already.
            urls[fn] = info.get("thumburl") or info["url"]
    return urls


def slugify(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect")
    ap.add_argument("--out", default=os.path.join("..", "public", "logos"))
    ap.add_argument("--map", default=os.path.join("..", "src", "lib", "teamLogos.json"))
    ap.add_argument("--teams", nargs="*")
    args = ap.parse_args()

    if not CONTACT:
        print("[FATAL] Set LIQUIPEDIA_CONTACT before running.", file=sys.stderr)
        sys.exit(1)

    s = session()
    names = args.teams or list(TEAM_NAME_MAP.keys())
    titles = [TEAM_NAME_MAP.get(n, n) for n in names]

    if args.inspect:
        icons = fetch_team_icons(s, [TEAM_NAME_MAP.get(args.inspect, args.inspect)])
        dark, light = icons.get(TEAM_NAME_MAP.get(args.inspect, args.inspect), (None, None))
        print("dark icon:", dark)
        print("light icon:", light)
        return

    icons_by_title = fetch_team_icons(s, titles)
    per_team_files = {}
    missing = []
    for name, title in zip(names, titles):
        pair = icons_by_title.get(title)
        if pair is None or (pair[0] is None and pair[1] is None):
            missing.append(name)
            continue
        per_team_files[name] = pair
        print(f"{name} ({title}): dark={pair[0]} light={pair[1]}")

    if missing:
        print("\n[warn] {{Team}} rendered no icon for:", missing)

    all_filenames = [fn for pair in per_team_files.values() for fn in pair if fn]
    url_map = resolve_file_urls(s, all_filenames)

    os.makedirs(args.out, exist_ok=True)

    if os.path.exists(args.map):
        with open(args.map, encoding="utf-8") as f:
            logos = json.load(f)
    else:
        logos = {}

    dl_session = session()
    downloaded = 0
    for name, (dark, light) in per_team_files.items():
        chosen = dark or light
        if not chosen or chosen not in url_map:
            print(f"[warn] no resolvable image for {name} (dark={dark}, light={light})")
            continue
        url = url_map[chosen]
        ext = os.path.splitext(chosen)[1] or ".png"
        local_name = f"{slugify(name)}{ext}"
        local_path = os.path.join(args.out, local_name)
        # Always overwrite -- a same-named file from a previous run (e.g.
        # the earlier "full logo" pass, before this script switched to the
        # small-icon render) would otherwise silently survive under this
        # identical filename forever.
        time.sleep(REQUEST_DELAY)
        r = dl_session.get(url)
        r.raise_for_status()
        with open(local_path, "wb") as f:
            f.write(r.content)
        logos[name] = {"logo": f"/logos/{local_name}", "tag": TAGS.get(name, name)}
        downloaded += 1
        print(f"downloaded {name} -> {local_path} ({'dark' if dark and chosen == dark else 'light'})")

    with open(args.map, "w", encoding="utf-8") as f:
        json.dump(logos, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\n{ATTRIBUTION}")
    print(f"Wrote {downloaded}/{len(per_team_files)} logos to {args.out}, updated {args.map}")


if __name__ == "__main__":
    main()
