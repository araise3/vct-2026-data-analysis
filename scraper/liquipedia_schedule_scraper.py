#!/usr/bin/env python3
"""
Scrape from Liquipedia the two things the Events page needs that this site's
own VLR-derived data does not carry:

  1. EVENT METADATA -- start/end dates, prize pool, host city/country/venue,
     Liquipedia tier, and which patch(es) the event was actually played on
     (`patchStart`/`patchEnd`, from the infobox's own `|patch=`/`|epatch=`
     fields -- ground truth, not inferred from date overlap with a patch's
     release date). `public/data/events.json` HAS `dates`/`prize`/`location`
     columns but they are null on every one of its 55 rows (the VLR scraper
     never populated them), so today the Events page has nothing real to put
     in rft.gg's Teams/Prize/Location trio.
     -> public/data/event_meta.json

  2. UPCOMING MATCH SCHEDULE -- this site's match_results.json is completed
     matches only (verified: 1902 rows, zero future-dated), so a calendar of
     upcoming matches cannot be built from it at all.
     -> public/data/upcoming_matches.json

WHY A SEPARATE FILE FROM liquipedia_tournament_scraper.py
---------------------------------------------------------
That scraper's TARGET_STAGES is deliberately scoped to *currently-live group
stages* (its own comment explains why: qualifying odds only mean anything
while a round robin is unfinished). Metadata is wanted for EVERY event, and
the schedule is one wiki-wide page, so folding these in would force
TARGET_STAGES to mean two different things at once. Same standalone-file
convention every scraper in this directory already follows -- the HTTP/cache/
parse helpers below are copied, not imported. KEEP IN SYNC with
liquipedia_tournament_scraper.py if its copies of these change.

TWO DIFFERENT API ENDPOINTS, FOR A MEASURED REASON
---------------------------------------------------
Metadata uses `action=query&prop=revisions` (raw wikitext, cheap). The
`{{Infobox league}}` template carries every field as a clean named param.

The schedule CANNOT use that path. Verified against real wikitext: a stage
page's `{{Match}}` templates are *literally empty* -- `|M1={{Match}}` -- with
every team, score, date and time injected from Liquipedia's own LPDB at
render time. Only day headers (`|M1header=July 16, 2026`) survive into
wikitext, which is not enough to build a fixture list. So the schedule uses
`action=parse` on the wiki's own aggregated `Liquipedia:Matches` page.

That endpoint is normally the expensive one (liquipedia_roster_scraper.py
pays PARSE_REQUEST_DELAY = 32s per call), but this specific page is
server-cached and measured at ~0.2s, and it is ONE request for the entire
wiki's fixture list rather than one per event. Still spaced by
PARSE_REQUEST_DELAY on principle, which costs nothing at one call.

COMPLIANCE CHECKLIST (same as the other Liquipedia scrapers here)
-----------------------------------------------------------------
  * Custom User-Agent identifying the project + contact info.
  * >= 2s between requests (REQUEST_DELAY = 2.5s; 32s before an action=parse).
  * Results cached to disk (CACHE_TTL_HOURS, shorter for the volatile feed).
  * Liquipedia content is CC-BY-SA 3.0 -- both outputs carry a
    _meta.attribution string the site must render wherever this is displayed.

USAGE
-----
  python3 liquipedia_schedule_scraper.py --inspect "Vct 2026 Americas Stage 2"
      Fetch+parse one event's metadata and print it, writing nothing.

  python3 liquipedia_schedule_scraper.py --events-only
      Refresh event_meta.json only (~18 cheap requests).

  python3 liquipedia_schedule_scraper.py --matches-only
      Refresh upcoming_matches.json only (ONE request) -- what the frequent
      CI job runs, since fixtures move and prize pools don't.

  python3 liquipedia_schedule_scraper.py
      Both.
"""

import argparse
import html as htmllib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("ERROR: pip install beautifulsoup4  (needed for the action=parse pass)")

API = "https://liquipedia.net/valorant/api.php"

CONTACT = os.environ.get("LIQUIPEDIA_CONTACT", "")
USER_AGENT = (
    "vct-2026-data-analysis/1.0 "
    "(https://github.com/araise3/vct-2026-data-analysis; {contact})"
)

REQUEST_DELAY = 2.5
PARSE_REQUEST_DELAY = 32
MAX_RETRIES = 4

# Metadata barely changes; the fixture feed is the whole point of running
# often, so it gets a short TTL or the 3-hourly CI job would just replay a
# stale cache.
CACHE_TTL_HOURS = 24
MATCHES_CACHE_TTL_HOURS = 1

_HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(_HERE, ".liquipedia_schedule_cache")
_DEFAULT_OUT = os.path.join(_HERE, "..", "public", "data")

META_ATTRIBUTION = (
    "Event dates, prize pools and locations from Liquipedia (liquipedia.net), "
    "licensed CC-BY-SA 3.0."
)
MATCHES_ATTRIBUTION = (
    "Upcoming match schedule from Liquipedia (liquipedia.net), "
    "licensed CC-BY-SA 3.0."
)

# ---------------------------------------------------------------------------
# Which events to fetch metadata for, and where they live on Liquipedia.
#
# KEYED BY EVENT `name`, NOT BY SLUG -- deliberately, and this is the one
# place this scraper departs from liquipedia_tournament_scraper.py (which
# keys on events.json's `slug`). Reason found by checking rather than
# assuming: `events.json` holds only the 55 VCT events, while
# match_results.json's own embedded events table holds 64 -- the 9 EWC
# events (Esports World Cup 2026 + its four regional qualifiers, plus the
# 2025 set) have NO events.json row and therefore no slug at all. `name` is
# the only identifier present in BOTH sources for EVERY event, and it is
# already what the Events page uses as its route param
# (/tournaments/{name}), so keying on it means EWC events can carry
# metadata too instead of being silently excluded.
#
# Every page title below was confirmed to exist via a batched
# action=query existence check before being hardcoded. Two were NOT
# guessable and would have failed silently:
#   * Masters is nested under the STAGE, not a /Masters/{City} path --
#     "VCT/2026/Masters/London" does not exist; "VCT/2026/Stage 2/Masters"
#     does. (Same scheme liquipedia_event_logos_scraper.py hit for 2024.)
#   * Champions is "VCT/2026/Champions", not "Valorant Champions 2026".
# Re-verify with --inspect before adding a new season; the title scheme has
# demonstrably changed between years.
#
# EWC's four regional qualifiers are deliberately absent: they have no
# standalone Liquipedia page with an Infobox of their own, and an event with
# no entry here simply renders without metadata (see the degraded path in
# src/lib/eventMeta.js) rather than breaking.
# ---------------------------------------------------------------------------
EVENT_PAGES = [
    {"eventName": "Vct 2026 Americas Kickoff", "page": "VCT/2026/Americas League/Kickoff"},
    {"eventName": "Vct 2026 Emea Kickoff", "page": "VCT/2026/EMEA League/Kickoff"},
    {"eventName": "Vct 2026 Pacific Kickoff", "page": "VCT/2026/Pacific League/Kickoff"},
    {"eventName": "Vct 2026 China Kickoff", "page": "VCT/2026/China League/Kickoff"},
    {"eventName": "Vct 2026 Americas Stage 1", "page": "VCT/2026/Americas League/Stage 1"},
    {"eventName": "Vct 2026 Emea Stage 1", "page": "VCT/2026/EMEA League/Stage 1"},
    {"eventName": "Vct 2026 Pacific Stage 1", "page": "VCT/2026/Pacific League/Stage 1"},
    {"eventName": "Vct 2026 China Stage 1", "page": "VCT/2026/China League/Stage 1"},
    {"eventName": "Vct 2026 Americas Stage 2", "page": "VCT/2026/Americas League/Stage 2"},
    {"eventName": "Vct 2026 Emea Stage 2", "page": "VCT/2026/EMEA League/Stage 2"},
    {"eventName": "Vct 2026 Pacific Stage 2", "page": "VCT/2026/Pacific League/Stage 2"},
    {"eventName": "Vct 2026 China Stage 2", "page": "VCT/2026/China League/Stage 2"},
    {"eventName": "Valorant Masters Santiago 2026", "page": "VCT/2026/Stage 1/Masters"},
    {"eventName": "Valorant Masters London 2026", "page": "VCT/2026/Stage 2/Masters"},
    {"eventName": "Valorant Champions 2026", "page": "VCT/2026/Champions"},
    {"eventName": "Esports World Cup 2026", "page": "Esports World Cup/2026"},
]

# Liquipedia writes country names in prose form; Flag.jsx needs an ISO-3166
# alpha-2 code matching a file in public/flags/. Every code below was checked
# to exist there. An unmapped country yields countryCode=None rather than a
# guess -- Flag renders nothing for a null code, whereas a wrong/missing code
# would render a broken-image glyph (its `alt` is the country name, so a 404
# is visible, not silent).
COUNTRY_TO_ISO = {
    "United States": "us", "Brazil": "br", "Chile": "cl", "Canada": "ca",
    "Great Britain": "gb", "United Kingdom": "gb", "England": "gb",
    "France": "fr", "Germany": "de", "Spain": "es", "Portugal": "pt",
    "Netherlands": "nl", "Belgium": "be", "Sweden": "se", "Denmark": "dk",
    "Poland": "pl", "Turkey": "tr", "Iceland": "is", "Italy": "it",
    "China": "cn", "South Korea": "kr", "Korea": "kr", "Japan": "jp",
    "Singapore": "sg", "Malaysia": "my", "Indonesia": "id", "Thailand": "th",
    "Philippines": "ph", "Vietnam": "vn", "Australia": "au", "India": "in",
    "Saudi Arabia": "sa", "United Arab Emirates": "ae", "Qatar": "qa",
    "Mexico": "mx", "Argentina": "ar", "Colombia": "co", "Peru": "pe",
}

# Same mapping liquipedia_tournament_scraper.py maintains (site name ->
# Liquipedia name), inverted here because the match feed gives us the
# LIQUIPEDIA spelling and we need this site's own canonical one. Copied
# rather than imported, per this directory's standalone-file convention --
# KEEP IN SYNC with that file's own copy.
SITE_TO_LIQUIPEDIA_NAME = {
    "LEVIATÁN": "Leviatán",
    "FNATIC": "Fnatic",
    "JDG Esports": "JD Gaming",
    "KIWOOM DRX": "DRX",
    "ENVY": "Envy",
    "Gen.G": "Gen.G Esports",
    "Xi Lai Gaming": "XLG Esports",
}
LIQUIPEDIA_TO_SITE_NAME = {v: k for k, v in SITE_TO_LIQUIPEDIA_NAME.items()}


def canonical_team_name(liquipedia_name):
    if liquipedia_name is None:
        return None
    return LIQUIPEDIA_TO_SITE_NAME.get(liquipedia_name, liquipedia_name)


# ---------------------------------------------------------------------------
# HTTP + cache (same pattern as the sibling scrapers)
# ---------------------------------------------------------------------------
def make_session() -> requests.Session:
    if not CONTACT:
        sys.exit(
            "ERROR: set a contact address first, e.g.\n"
            "  export LIQUIPEDIA_CONTACT='you@example.com'\n"
            "Liquipedia's ToU requires contact info in the User-Agent and "
            "blocks generic ones."
        )
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT.format(contact=CONTACT),
        "Accept-Encoding": "gzip",
    })
    return s


def cache_path(key: str) -> str:
    safe = re.sub(r"[^\w.-]", "_", key)
    return os.path.join(CACHE_DIR, f"{safe}")


def read_cache(key: str, ttl_hours):
    p = cache_path(key)
    if not os.path.exists(p):
        return None
    if (time.time() - os.path.getmtime(p)) / 3600 > ttl_hours:
        return None
    with open(p, encoding="utf-8") as f:
        return f.read()


def write_cache(key: str, text: str) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(key), "w", encoding="utf-8") as f:
        f.write(text)


def _get(session, params, delay, timeout=60):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(API, params=params, timeout=timeout)
            if r.status_code == 200:
                time.sleep(delay)
                return r.json()
            if r.status_code == 429:
                wait = 30 * attempt
                print(f"  [429] rate limited; sleeping {wait}s")
                time.sleep(wait)
                continue
            print(f"  [{r.status_code}] (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    return None


def fetch_wikitext(session, title: str, use_cache=True):
    """Raw wikitext for a page, or None if it doesn't exist."""
    if use_cache:
        cached = read_cache(f"wt_{title}", CACHE_TTL_HOURS)
        if cached is not None:
            return cached
    j = _get(session, {
        "action": "query", "format": "json", "prop": "revisions",
        "rvprop": "content", "rvslots": "main", "titles": title, "redirects": 1,
    }, REQUEST_DELAY, timeout=25)
    if not j:
        print(f"  [FAILED] {title}")
        return None
    for _, page in j.get("query", {}).get("pages", {}).items():
        if "missing" in page:
            return None
        revs = page.get("revisions") or []
        if not revs:
            return None
        text = revs[0]["slots"]["main"]["*"]
        write_cache(f"wt_{title}", text)
        return text
    return None


def fetch_rendered(session, title: str, use_cache=True):
    """Rendered HTML for a page via action=parse."""
    if use_cache:
        cached = read_cache(f"html_{title}", MATCHES_CACHE_TTL_HOURS)
        if cached is not None:
            return cached
    j = _get(session, {
        "action": "parse", "format": "json", "page": title, "prop": "text",
    }, PARSE_REQUEST_DELAY, timeout=120)
    if not j or "parse" not in j:
        print(f"  [FAILED] parse {title}")
        return None
    html = j["parse"]["text"]["*"]
    write_cache(f"html_{title}", html)
    return html


# ---------------------------------------------------------------------------
# Wikitext parsing
# ---------------------------------------------------------------------------
def clean(v):
    """Strip wiki markup, HTML tags and entities from a fragment. Same helper
    as the sibling scrapers, plus HTML-entity unescaping -- Liquipedia writes
    a non-breaking space in event names ("VALORANT Masters London&nbsp;2026")
    which would otherwise survive into the JSON as a literal entity."""
    if v is None:
        return None
    v = re.sub(r"\[\[(?:[^\|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", v)
    v = re.sub(r"''+", "", v)
    v = re.sub(r"<[^>]+>", "", v)
    v = htmllib.unescape(v)
    v = v.replace(" ", " ")
    v = re.sub(r"\s+", " ", v).strip()
    return v or None


def infobox_params(wikitext):
    """Named params of the first {{Infobox league}}, brace-depth aware so a
    param whose value contains a nested template ({{Abbr/KST}} in the date
    fields) isn't split on that template's own internal pipes."""
    start = re.search(r"\{\{\s*Infobox league\b", wikitext)
    if not start:
        return {}
    i, depth = start.end(), 1
    while i < len(wikitext) - 1:
        if wikitext[i] == "{" and wikitext[i + 1] == "{":
            depth += 1; i += 2; continue
        if wikitext[i] == "}" and wikitext[i + 1] == "}":
            depth -= 1; i += 2
            if depth == 0:
                break
            continue
        i += 1
    body = wikitext[start.end():i - 2]

    parts, buf, d2, k = [], [], 0, 0
    while k < len(body):
        if body.startswith("{{", k) or body.startswith("[[", k):
            d2 += 1; buf.append(body[k:k + 2]); k += 2; continue
        if body.startswith("}}", k) or body.startswith("]]", k):
            d2 -= 1; buf.append(body[k:k + 2]); k += 2; continue
        if body[k] == "|" and d2 == 0:
            parts.append("".join(buf)); buf = []; k += 1; continue
        buf.append(body[k]); k += 1
    parts.append("".join(buf))

    params = {}
    for p in parts:
        if "=" in p:
            key, _, val = p.partition("=")
            params[key.strip().lower()] = val.strip()
    return params


ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_money(v):
    """'250,000' -> 250000. Returns None (never 0) when absent or
    unparseable, so the UI can tell 'no prize pool published' apart from a
    real zero."""
    if not v:
        return None
    digits = re.sub(r"[^\d]", "", v)
    return int(digits) if digits else None


def parse_event_meta(wikitext, page_title):
    p = infobox_params(wikitext)
    if not p:
        return None

    def field(name):
        return clean(p.get(name))

    sdate, edate = field("sdate"), field("edate")
    # Liquipedia occasionally writes a partial date ("2026-09") or free text;
    # only pass through values the frontend's date helpers can actually parse.
    if sdate and not ISO_DATE_RE.match(sdate):
        sdate = None
    if edate and not ISO_DATE_RE.match(edate):
        edate = None

    country = field("country")
    # Ground truth for which patch(es) an event was actually played on,
    # straight from the same Infobox league every other field here comes
    # from -- `|patch=` is the version live when the event started,
    # `|epatch=` (present only when it DIFFERS from `patch`, i.e. a patch
    # shipped mid-event) is the version live when it ended. Defaulting
    # patchEnd to patchStart when epatch is absent means every event that
    # ran on a single patch still gets a complete (patchStart, patchEnd)
    # pair instead of a null second half. Verified against real pages:
    # Kickoff/Masters/EWC events had only `patch=`; Stage 1 (a 6-week
    # group stage) had both `patch=12.06` and `epatch=12.08`. An
    # unplayed future event (Champions 2026, as of this writing) has
    # `patch=` present but empty -- `field()` already collapses that to
    # None via clean()'s `v or None`, so patchStart/patchEnd both come out
    # None rather than the literal empty string, and the frontend's
    # "TBD" branch is what a null triggers, not a truthy empty value.
    patch_start = field("patch")
    patch_end = field("epatch") or patch_start
    return {
        "liquipediaPage": page_title,
        "displayName": field("name"),
        "startDate": sdate,
        "endDate": edate,
        "prizePoolUsd": parse_money(p.get("prizepoolusd")),
        "country": country,
        "countryCode": COUNTRY_TO_ISO.get(country) if country else None,
        "city": field("city"),
        "venue": field("venue"),
        "tier": field("liquipediatier"),
        "patchStart": patch_start,
        "patchEnd": patch_end,
    }


# ---------------------------------------------------------------------------
# Rendered-HTML parsing for the fixture feed
# ---------------------------------------------------------------------------
def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "tbd").lower()).strip("-") or "tbd"


# Circuits that live under a "VCT/" page prefix but are NOT tier-1 VCT and are
# deliberately not tracked by this site. Without this list the "VCT-looking
# match was dropped" warning fires ~49 times on every single run (Game
# Changers alone is 6 pages), which would train the reader to ignore it and
# bury the one case it exists to catch: a real tier-1 page being renamed.
UNTRACKED_CIRCUIT_RE = re.compile(
    r"^VCT/\d{4}/(Game Changers|Challengers|Ascension)\b", re.I)


def parse_matches(html, page_to_event):
    """
    Every .match-info block on Liquipedia:Matches -> a fixture row, filtered
    to the events this site actually tracks.

    The feed is wiki-wide (Challengers, Game Changers, off-season events), so
    most blocks are expected to be dropped -- that's normal, not an error.

    JOIN: each block links its tournament with a title like
    "VCT/2026/Americas League/Stage 2/Group Stage#Week 4". Matching is by
    LONGEST PREFIX against the known page titles, not equality -- Play-Ins
    and Playoffs matches live on ".../Stage 2/Play-Ins" subpages that appear
    in no table, and would all be dropped by an exact match. Longest (rather
    than first) prefix matters so a page and a hypothetical parent page
    can't both match and pick the wrong one. The leftover path segment
    becomes the phase.
    """
    soup = BeautifulSoup(html, "html.parser")
    blocks = soup.select(".match-info")
    prefixes = sorted(page_to_event.items(), key=lambda kv: -len(kv[0]))

    out, dropped, dropped_vct = [], 0, 0
    unmatched_pages = set()
    for b in blocks:
        timer = b.select_one(".timer-object[data-timestamp]")
        if not timer:
            continue
        try:
            ts = int(timer["data-timestamp"])
        except (TypeError, ValueError):
            continue

        tour = b.select_one(".match-info-tournament a[title]")
        tour_title = (tour.get("title") or "").split("#")[0].strip() if tour else ""
        match = next((
            (pg, ev) for pg, ev in prefixes
            if tour_title == pg or tour_title.startswith(pg + "/")
        ), None)
        if not match:
            dropped += 1
            if tour_title.startswith("VCT/") and not UNTRACKED_CIRCUIT_RE.match(tour_title):
                dropped_vct += 1
                unmatched_pages.add(tour_title)
            continue
        page, event_name = match
        phase = tour_title[len(page):].strip("/") or None

        teams = []
        for op in b.select(".match-info-header-opponent"):
            a = op.select_one("a[title]")
            # A TBD bracket slot renders with no link at all -- emit null so
            # the UI branches on nullness instead of sniffing a magic string.
            teams.append(canonical_team_name(clean(a.get("title"))) if a else None)
        while len(teams) < 2:
            teams.append(None)

        # Liquipedia shows "vs" (no score elements) until a match starts, and
        # a real scoreline once it has -- that presence/absence IS the
        # started signal; there is no live/ class on this page to read.
        score_els = b.select(".match-info-header-scoreholder-score")
        scores = []
        for el in score_els[:2]:
            t = el.get_text(strip=True)
            scores.append(int(t) if t.isdigit() else None)
        while len(scores) < 2:
            scores.append(None)
        started = bool(score_els)

        lower = b.select_one(".match-info-header-scoreholder-lower")
        bo = None
        if lower:
            m = re.search(r"Bo(\d+)", lower.get_text(strip=True), re.I)
            if m:
                bo = int(m.group(1))

        out.append({
            "key": f"{ts}|{_slug(teams[0])}|{_slug(teams[1])}",
            "event": event_name,
            "liquipediaPage": tour_title,
            "phase": phase,
            "timestamp": ts,
            "bestOf": bo,
            "team1": teams[0],
            "team2": teams[1],
            "score1": scores[0],
            "score2": scores[1],
            "started": started,
        })

    out.sort(key=lambda m: (m["timestamp"], m["key"]))
    print(f"  {len(blocks)} blocks -> {len(out)} tracked, {dropped} dropped "
          f"(other circuits/off-season)")
    if unmatched_pages:
        print(f"  [warn] {dropped_vct} match(es) on {len(unmatched_pages)} tier-1-looking "
              f"page(s) not in EVENT_PAGES -- a page rename looks exactly like this:")
        for pg in sorted(unmatched_pages):
            print(f"           {pg}")
    return out


def warn_unknown_teams(matches, out_dir):
    """Diff every emitted team name against this site's real team set. Warns
    rather than fails -- a genuinely new org is legitimate, but a Liquipedia
    rename silently producing a team with no logo/profile is not something to
    discover in the browser. Same diligence that previously caught
    'Gen.G Esports' and 'XLG Esports'."""
    p = os.path.join(out_dir, "team_buckets.json")
    if not os.path.exists(p):
        return
    try:
        with open(p, encoding="utf-8") as f:
            known = set(json.load(f).get("meta", {}).keys())
    except (json.JSONDecodeError, OSError):
        return
    if not known:
        return
    seen = {t for m in matches for t in (m["team1"], m["team2"]) if t}
    unknown = sorted(seen - known)
    if unknown:
        print(f"  [warn] {len(unknown)} team name(s) not in team_buckets.json "
              f"(no logo/profile will resolve): {', '.join(unknown)}")
        print("         -> add to SITE_TO_LIQUIPEDIA_NAME if it's a spelling difference")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def scrape_event_meta(session, out_dir, use_cache=True):
    print("\n=== Event metadata ===")
    # Merge into whatever's on disk rather than overwriting wholesale -- one
    # page failing this run must not wipe every other event's good data.
    # (liquipedia_tournament_scraper.py documents a real incident from getting
    # this wrong.)
    path = os.path.join(out_dir, "event_meta.json")
    events = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                events = json.load(f).get("events", {})
        except (json.JSONDecodeError, OSError):
            events = {}

    for cfg in EVENT_PAGES:
        name, page = cfg["eventName"], cfg["page"]
        wt = fetch_wikitext(session, page, use_cache=use_cache)
        if wt is None:
            print(f"  [FAILED] {name}: page missing -- {page}")
            continue
        meta = parse_event_meta(wt, page)
        if not meta:
            print(f"  [warn] {name}: no Infobox league found on {page}")
            continue
        events[name] = meta
        patch_range = (
            meta["patchStart"] if meta["patchStart"] == meta["patchEnd"]
            else f"{meta['patchStart']}-{meta['patchEnd']}"
        ) if meta["patchStart"] else "TBD"
        print(f"  {name}: {meta['startDate']}..{meta['endDate']} "
              f"${meta['prizePoolUsd']} {meta['city']} patch={patch_range}")

    write_json(path, {
        "_meta": {
            "source": "Liquipedia", "license": "CC-BY-SA 3.0",
            "attribution": META_ATTRIBUTION, "generatedAt": _now_iso(),
        },
        "events": events,
    })
    print(f"Wrote {len(events)} event(s) to {path}")


def scrape_matches(session, out_dir, use_cache=True):
    print("\n=== Upcoming matches ===")
    html = fetch_rendered(session, "Liquipedia:Matches", use_cache=use_cache)
    if html is None:
        print("  [FAILED] could not fetch the match feed -- leaving existing file alone")
        return
    page_to_event = {c["page"]: c["eventName"] for c in EVENT_PAGES}
    matches = parse_matches(html, page_to_event)
    warn_unknown_teams(matches, out_dir)

    path = os.path.join(out_dir, "upcoming_matches.json")
    write_json(path, {
        "_meta": {
            "source": "Liquipedia", "license": "CC-BY-SA 3.0",
            "attribution": MATCHES_ATTRIBUTION, "fetchedAt": _now_iso(),
        },
        "matches": matches,
    })
    print(f"Wrote {len(matches)} match(es) to {path}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inspect", metavar="EVENT_NAME",
                    help="Fetch+parse one event's metadata, print it, write nothing")
    ap.add_argument("--events-only", action="store_true")
    ap.add_argument("--matches-only", action="store_true")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out", default=_DEFAULT_OUT)
    args = ap.parse_args()

    session = make_session()
    use_cache = not args.no_cache
    out_dir = os.path.abspath(args.out)

    if args.inspect:
        cfg = next((c for c in EVENT_PAGES if c["eventName"] == args.inspect), None)
        if not cfg:
            sys.exit(f"Unknown event: {args.inspect!r}\nKnown: "
                     + "\n  ".join(c["eventName"] for c in EVENT_PAGES))
        wt = fetch_wikitext(session, cfg["page"], use_cache=use_cache)
        if wt is None:
            sys.exit(f"Page missing: {cfg['page']}")
        print(json.dumps(parse_event_meta(wt, cfg["page"]), indent=2, ensure_ascii=False))
        return

    if not args.matches_only:
        scrape_event_meta(session, out_dir, use_cache=use_cache)
    if not args.events_only:
        scrape_matches(session, out_dir, use_cache=use_cache)


if __name__ == "__main__":
    main()
