#!/usr/bin/env python3
"""
Fetch each player's real (legal) name from their own Liquipedia page's
Infobox player template (`|name=`), for every player handle this site
tracks -- not just current partnered-org rosters.

REPLACES data_prep/build_player_real_names.py's Google Sheet source
-------------------------------------------------------------------
That script pulled from the "VCT Global Contract Database" Google Sheet,
which only ever covers players currently under a partnered-org contract
(276 of this site's 659 known handles, ~42%) -- anyone retired, benched to
a Challengers/academy squad, or on a team that's never held a partner slot
has no row there at all, contract-status data going stale the moment a
player's deal lapses even if they're still actively playing. Liquipedia has
a dedicated page for essentially every pro who's played on camera, current
contract or not, and that page's own Infobox already carries a `|name=`
field maintained the same way every other Liquipedia infobox fact is (see
liquipedia_roster_scraper.py's own docstring on why this wiki is treated as
a reliable source elsewhere in this pipeline). Confirmed directly before
committing to this as the replacement: TenZ's page gives
`|name=Tyson Van Ngo` (matches the sheet's own now-superseded row), and it
resolves for plenty of players the sheet never had at all.

Same ToU-compliance approach as every other scraper in this directory:
MediaWiki API only, custom User-Agent with contact info, >=2s between
requests, disk cache, CC-BY-SA 3.0 attribution.

BATCHED, NOT ONE-PAGE-AT-A-TIME
--------------------------------
`action=query&prop=revisions` (unlike `action=parse`) accepts up to 50
`titles=A|B|C` in one request at the normal 1-request/2.5s rate -- for
~659 known handles that's ~14 requests total (confirmed against the live
API: response mapping below correctly resolves a real mixed batch), not
659 individual fetches. `redirects=1` auto-follows a simple page-move
redirect (an old alias -> a player's current page) in the same call.

MediaWiki's response for a batched request returns `normalized`/
`redirects` as separate top-level arrays (`from` -> `to`) and `pages`
keyed by the FINAL resolved title, not the originally-requested one --
`resolve_batch()` below composes both maps to look each requested handle's
own page back up, the same "don't key on the rendered/resolved label,
match back to what was actually asked for" class of bug already documented
on liquipedia_team_logos_scraper.py's own icon-matching function.

WHAT COUNTS AS A REAL MATCH
----------------------------
A `|name=` value is only trusted when it's found inside an actual
`{{Infobox player` block -- guards against a handle that happens to
resolve to some other kind of Liquipedia page (a disambiguation page, a
team page, an unrelated non-player article) which could carry an unrelated
`|name=`-shaped field of its own. A page with no such infobox at all (the
common case for a genuinely wrong/nonexistent handle) is simply skipped,
same as a straightforward 404.

USAGE
-----
  python3 liquipedia_player_names_scraper.py --inspect TenZ aspas
      Dump the resolved title + extracted name for a few handles, no
      write. Use this to sanity-check a newly-added or oddly-spelled
      handle before trusting a full run.

  python3 liquipedia_player_names_scraper.py
      Reads every player handle from ../public/data/player_buckets.json's
      own `meta` table (this site's full known-player list, every season),
      fetches all of them, and writes
      ../public/data/player_real_names.json in the exact same
      `{handleLower: "First Last"}` shape the old Google-Sheet-sourced
      script produced -- PlayerProfile.jsx needed no changes.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

import requests

API = "https://liquipedia.net/valorant/api.php"

CONTACT = os.environ.get("LIQUIPEDIA_CONTACT", "")
USER_AGENT = (
    "vct-2026-data-analysis/1.0 "
    "(https://github.com/araise3/vct-2026-data-analysis; {contact})"
)

REQUEST_DELAY = 2.5
MAX_RETRIES = 4
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".liquipedia_player_names_cache")

ATTRIBUTION = "Player names from Liquipedia (liquipedia.net), licensed CC-BY-SA 3.0."

HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(HERE)
DEFAULT_PLAYERS_FROM = os.path.join(_REPO_ROOT, "public", "data", "player_buckets.json")
DEFAULT_OUT = os.path.join(_REPO_ROOT, "public", "data", "player_real_names.json")

# A handful of handles this site stores don't match their Liquipedia page
# title verbatim -- same category of gap TEAM_PAGES fixes for team names in
# liquipedia_roster_scraper.py, just not yet populated for players (nothing
# needed one before this script existed). Add entries here as they're
# found via --inspect on a handle that comes back with no infobox.
HANDLE_PAGE_OVERRIDES = {}


def session():
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


def cache_path(key):
    os.makedirs(CACHE_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)
    return os.path.join(CACHE_DIR, f"{safe}.json")


def cached_post(s, key, params):
    path = cache_path(key)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = s.get(API, params=params, timeout=25)
            if r.status_code == 200:
                time.sleep(REQUEST_DELAY)
                data = r.json()
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                return data
            if r.status_code == 429:
                wait = 30 * attempt
                print(f"  [429] rate limited; sleeping {wait}s")
                time.sleep(wait)
                continue
            print(f"  [{r.status_code}] batch request (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    print("  [FAILED] batch request")
    return {"query": {"pages": {}}}


def page_title(handle):
    return HANDLE_PAGE_OVERRIDES.get(handle, handle)


def resolve_batch(s, handles):
    """One action=query&prop=revisions call for up to 50 handles, returning
    {original_handle: wikitext_or_None}."""
    titles_by_handle = {h: page_title(h) for h in handles}
    titles_param = "|".join(titles_by_handle.values())
    digest = hashlib.md5(titles_param.encode("utf-8")).hexdigest()
    data = cached_post(s, "batch_" + digest, {
        "action": "query", "format": "json",
        "prop": "revisions", "rvprop": "content", "rvslots": "main",
        "redirects": 1, "titles": titles_param,
    })
    query = data.get("query", {})

    # Compose normalized (case/whitespace) and redirects (page-move) chains
    # into one from->to map, so a requested title can be looked up in
    # `pages` (keyed by the FINAL resolved title) however many hops away.
    resolved_to = {}
    for entry in query.get("normalized", []):
        resolved_to[entry["from"]] = entry["to"]
    for entry in query.get("redirects", []):
        src = entry["from"]
        # If `src` was itself a normalization target, chain through it.
        src = next((k for k, v in resolved_to.items() if v == src), src)
        resolved_to[src] = entry["to"]

    pages_by_title = {p.get("title"): p for p in query.get("pages", {}).values()}

    out = {}
    for handle, title in titles_by_handle.items():
        final_title = title
        # Follow the chain (normalize, then possibly redirect) to whatever
        # title `pages` is actually keyed by.
        seen = set()
        while final_title in resolved_to and final_title not in seen:
            seen.add(final_title)
            final_title = resolved_to[final_title]
        page = pages_by_title.get(final_title) or pages_by_title.get(title)
        if not page or "missing" in page:
            out[handle] = None
            continue
        revs = page.get("revisions") or []
        out[handle] = revs[0]["slots"]["main"]["*"] if revs else None
    return out


# Strips the wiki markup an Infobox `|name=` value can plausibly contain --
# a piped link (`[[Real Name|Real Name]]`), bold/italic markers, or an HTML
# comment -- down to plain text. Deliberately narrow (not a general
# wikitext-to-text converter): these are the only markup forms actually
# observed in a `|name=` field across the players checked while building
# this script.
def clean_wiki_value(v):
    v = re.sub(r"<!--.*?-->", "", v, flags=re.DOTALL)
    v = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", v)
    v = re.sub(r"'{2,}", "", v)
    return v.strip()


def extract_real_name(wikitext):
    """`|romanized_name=` (preferred) or `|name=` from the page's own
    Infobox player block, or None if the page has no such infobox (wrong
    page / disambiguation / non-player) or neither field is present.

    `romanized_name` only exists on players whose `name` is in a non-Latin
    script (confirmed against real infoboxes: Korean/Chinese players like
    Secret/WudiYuChEn carry both -- `name=김하진`/`romanized_name=Kim Ha-jin`
    -- while Latin-name players like v1c/Jinggg have no romanized_name
    field at all, `name` alone already being Latin). Preferring it keeps
    every displayed name in the same script the rest of the site already
    uses (team names, VLR handles, every other player's `name`), rather
    than showing native-script text for some players and Latin for others
    depending on which field happened to be populated."""
    if not wikitext:
        return None
    m = re.search(r"\{\{\s*Infobox\s+player\b", wikitext, re.IGNORECASE)
    if not m:
        return None
    window = wikitext[m.end():m.end() + 4000]
    for field in ("romanized_name", "name"):
        # [ \t]*, not \s* -- \s matches newlines too, so on a genuinely
        # EMPTY field ("|romanized_name=" immediately followed by "\n")
        # a \s* trailing the "=" would silently absorb that newline and
        # keep matching into the START OF THE NEXT LINE, capturing
        # "|familyname=Kartal" (the next field's own "|" and all) as if it
        # were this field's value. Confirmed live on Eternal Fire's Spear,
        # whose romanized_name is blank -- caught 4/591 wrong on the first
        # full run this way before being traced back to this one regex.
        m2 = re.search(rf"^[ \t]*\|[ \t]*{field}[ \t]*=[ \t]*(.+)$", window, re.MULTILINE)
        if m2:
            value = clean_wiki_value(m2.group(1))
            if value:
                return value
    return None


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def load_handles(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return sorted(data["meta"].keys())


def fetch_all(s, handles):
    names = {}
    total_batches = (len(handles) + 49) // 50
    for i, batch in enumerate(chunked(handles, 50), start=1):
        print(f"  batch {i}/{total_batches} ({len(batch)} handles)...")
        wikitexts = resolve_batch(s, batch)
        for handle, wikitext in wikitexts.items():
            name = extract_real_name(wikitext)
            if name:
                names[handle] = name
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", nargs="+", metavar="HANDLE",
                     help="Dump the resolved title + extracted name for specific handles, no write.")
    ap.add_argument("--players-from", default=DEFAULT_PLAYERS_FROM,
                     help="player_buckets.json (or any file with a top-level `meta` object of handles) to source the handle list from.")
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    s = session()

    if args.inspect:
        wikitexts = resolve_batch(s, args.inspect)
        for handle in args.inspect:
            wikitext = wikitexts.get(handle)
            name = extract_real_name(wikitext)
            has_infobox = bool(wikitext and re.search(r"\{\{\s*Infobox\s+player\b", wikitext, re.IGNORECASE))
            print(f"{handle}: page_title={page_title(handle)!r} found={wikitext is not None} "
                  f"has_infobox={has_infobox} name={name!r}")
        return

    handles = load_handles(args.players_from)
    print(f"Fetching real names for {len(handles)} players...")
    names = {handle.lower(): name for handle, name in fetch_all(s, handles).items()}

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=2, sort_keys=True)

    print(f"Resolved {len(names)} of {len(handles)} players ({len(names) / len(handles):.0%}).")
    print(f"Wrote {args.out}")
    print(ATTRIBUTION)


if __name__ == "__main__":
    main()
