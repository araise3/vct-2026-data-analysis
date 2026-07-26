#!/usr/bin/env python3
"""
Scrape team rosters + coaching staff from Liquipedia's Valorant wiki.

WHY THE API AND NOT THE PAGE HTML
---------------------------------
Liquipedia's API Terms of Use (https://liquipedia.net/api-terms-of-use)
state plainly: "Automated access to non-API endpoints (ie, generated
HTML pages) is not permitted." So this does NOT scrape
liquipedia.net/valorant/<Team> even though that's the page a human
reads -- it goes through the MediaWiki API and parses the page's raw
wikitext instead.

It uses action=query&prop=revisions (not action=parse) deliberately:
both return page content, but Liquipedia rate-limits action=parse to
1 request / 30 seconds while general requests are 1 / 2 seconds. Same
data, 15x faster, still fully within their limits.

COMPLIANCE CHECKLIST (all required by their ToU)
------------------------------------------------
  * Custom User-Agent identifying the project + contact info. Generic
    agents ("python-requests", etc.) are explicitly "likely to be
    blocked" -- set CONTACT below before running.
  * gzip accepted (requests does this by default; asserted explicitly).
  * >= 2s between requests. REQUEST_DELAY is 2.5s for headroom.
  * Results cached to disk; a cached page younger than CACHE_TTL_HOURS
    is not re-requested. Their ToU asks callers to "re-use / cache your
    API results for as long as possible".
  * Liquipedia content is CC-BY-SA 3.0. That REQUIRES attribution
    wherever this data is displayed -- the output JSON carries a
    _meta.attribution string for the site to render. Don't drop it.

USAGE
-----
  python3 liquipedia_roster_scraper.py --inspect "Leviatán"
      Dump one page's raw wikitext to stdout. Run this FIRST -- the
      parser below is written defensively against several possible
      template shapes, but it has not been validated against real
      Valorant-wiki output (the sandbox this was written in can't reach
      liquipedia.net), so confirm the templates match before trusting a
      full run.

  python3 liquipedia_roster_scraper.py --out ../data_prep/liquipedia_rosters.json
      Scrape every team in TEAM_PAGES and write the roster JSON.

  python3 liquipedia_roster_scraper.py --teams "LEVIATÁN" "FNATIC"
      Only these teams.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

API = "https://liquipedia.net/valorant/api.php"

# ---------------------------------------------------------------------------
# SET THIS before running. Liquipedia's ToU requires contact info in the
# User-Agent, and explicitly warns that generic agents get blocked.
# ---------------------------------------------------------------------------
CONTACT = os.environ.get("LIQUIPEDIA_CONTACT", "")
USER_AGENT = (
    "vct-2026-data-analysis/1.0 "
    "(https://github.com/araise3/vct-2026-data-analysis; {contact})"
)

REQUEST_DELAY = 2.5      # ToU minimum is 2.0s; extra headroom
MAX_RETRIES = 4
CACHE_TTL_HOURS = 24
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".liquipedia_cache")

ATTRIBUTION = (
    "Roster and staff data from Liquipedia (liquipedia.net), "
    "licensed CC-BY-SA 3.0."
)

# ---------------------------------------------------------------------------
# Our team names come from VLR and don't always match Liquipedia page
# titles. Anything not listed here falls back to using the team name
# verbatim as the page title.
#
# These mappings are BEST-GUESS and unverified -- the sandbox couldn't
# reach liquipedia.net to confirm them. --inspect each one, or run with
# --report-missing to see which pages 404.
# ---------------------------------------------------------------------------
TEAM_PAGES = {
    "LEVIATÁN": "Leviatán",
    "FNATIC": "Fnatic",
    "NRG": "NRG",
    "KRÜ Esports": "KRÜ Esports",
    "KIWOOM DRX": "DRX",
    "ENVY": "Envy",
    "LOUD": "LOUD",
    "MIBR": "MIBR",
    "T1": "T1",
    "TYLOO": "TYLOO",
    "VARREL": "VARREL",
    "FULL SENSE": "FULL SENSE",
    "GIANTX": "GIANTX",
    "ZETA DIVISION": "ZETA DIVISION",
    "Gen.G": "Gen.G",
    "PCIFIC Esports": "PCIFIC Esports",
}


def page_title(team: str) -> str:
    return TEAM_PAGES.get(team, team)


# ---------------------------------------------------------------------------
# HTTP
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


def cache_path(title: str) -> str:
    safe = re.sub(r"[^\w.-]", "_", title)
    return os.path.join(CACHE_DIR, f"{safe}.wikitext")


def read_cache(title: str):
    p = cache_path(title)
    if not os.path.exists(p):
        return None
    age_h = (time.time() - os.path.getmtime(p)) / 3600
    if age_h > CACHE_TTL_HOURS:
        return None
    with open(p, encoding="utf-8") as f:
        return f.read()


def write_cache(title: str, text: str) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(title), "w", encoding="utf-8") as f:
        f.write(text)


def fetch_wikitext(session, title: str, use_cache=True):
    """Raw wikitext for a page, or None if it doesn't exist."""
    if use_cache:
        cached = read_cache(title)
        if cached is not None:
            return cached

    params = {
        "action": "query",
        "format": "json",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": title,
        "redirects": 1,
    }
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(API, params=params, timeout=25)
            if r.status_code == 200:
                time.sleep(REQUEST_DELAY)
                pages = r.json().get("query", {}).get("pages", {})
                for _, page in pages.items():
                    if "missing" in page:
                        return None
                    revs = page.get("revisions") or []
                    if not revs:
                        return None
                    text = revs[0]["slots"]["main"]["*"]
                    write_cache(title, text)
                    return text
                return None
            if r.status_code == 429:
                # Their limiter. Back off hard -- this is the one status
                # where hammering would actually be abusive.
                wait = 30 * attempt
                print(f"  [429] rate limited on {title}; sleeping {wait}s")
                time.sleep(wait)
                continue
            print(f"  [{r.status_code}] {title} (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {title}: {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    print(f"  [FAILED] {title}")
    return None


# ---------------------------------------------------------------------------
# Wikitext template parsing
# ---------------------------------------------------------------------------
def parse_templates(text: str):
    """
    Yield (name, params) for every {{...}} template, including nested
    ones. Params are the named ones only ({{x|a=1}} -> {"a": "1"});
    positional args are ignored since every roster template we care
    about uses named parameters.

    Hand-rolled rather than regex because templates nest (a roster
    template contains player templates) and regex can't match balanced
    braces.
    """
    i, n = 0, len(text)
    while i < n - 1:
        if text[i] == "{" and text[i + 1] == "{":
            depth, j = 0, i
            while j < n - 1:
                if text[j] == "{" and text[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if text[j] == "}" and text[j + 1] == "}":
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                    continue
                j += 1
            body = text[i + 2 : j - 2]
            # split on top-level pipes only
            parts, buf, d2, k = [], [], 0, 0
            while k < len(body):
                c = body[k]
                if body.startswith("{{", k) or body.startswith("[[", k):
                    d2 += 1
                    buf.append(body[k : k + 2]); k += 2; continue
                if body.startswith("}}", k) or body.startswith("]]", k):
                    d2 -= 1
                    buf.append(body[k : k + 2]); k += 2; continue
                if c == "|" and d2 == 0:
                    parts.append("".join(buf)); buf = []; k += 1; continue
                buf.append(c); k += 1
            parts.append("".join(buf))

            # A template's name ends at the first pipe, newline, or
            # nested "{{". Liquipedia passes player templates as
            # positional args ({{Squad\n{{SquadPlayer|...}}\n}}), so
            # without this the "name" would swallow the entire nested
            # body and be useless for matching or debugging.
            name = re.split(r"[\n{|]", parts[0], 1)[0].strip()
            params = {}
            for p in parts[1:]:
                if "=" in p:
                    key, _, val = p.partition("=")
                    params[key.strip().lower()] = val.strip()
            yield name, params
            # recurse into the body so nested player templates are found
            yield from parse_templates(body)
            i = j
        else:
            i += 1


def first_of(params, *keys):
    for k in keys:
        v = params.get(k)
        if v:
            return v
    return None


def clean(v):
    """Strip wiki markup that shows up in name/role fields."""
    if not v:
        return None
    v = re.sub(r"\[\[(?:[^\|\]]*\|)?([^\]]*)\]\]", r"\1", v)  # [[A|B]] -> B
    v = re.sub(r"''+", "", v)
    v = re.sub(r"<[^>]+>", "", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v or None


PLAYER_TEMPLATE_HINT = re.compile(r"(squadplayer|teamroster/player|player\b|roster)", re.I)


def extract_roster(wikitext: str):
    """
    Pull players + staff out of a team page's wikitext.

    DEFENSIVE BY DESIGN: matches any template whose name looks
    player/squad/roster-ish and reads a union of the parameter names
    those templates use across Liquipedia wikis, rather than hardcoding
    one exact template signature. This is because the exact Valorant-wiki
    template shape could not be verified from the environment this was
    written in -- run --inspect and tighten this once you can see real
    output.
    """
    players, staff = [], []
    seen = set()

    for name, params in parse_templates(wikitext):
        if not PLAYER_TEMPLATE_HINT.search(name):
            continue
        handle = clean(first_of(params, "id", "player", "nick", "nickname"))
        if not handle:
            continue

        role = (clean(first_of(params, "role", "pos", "position")) or "").lower()
        entry = {
            "id": handle,
            "name": clean(first_of(params, "name", "fullname", "realname")),
            "flag": (first_of(params, "flag", "country", "nationality") or "").lower() or None,
            "joinDate": first_of(params, "joindate", "date_join", "join"),
            "leaveDate": first_of(params, "leavedate", "date_leave", "leave"),
            "role": clean(first_of(params, "role", "pos", "position")),
            "inactive": bool(first_of(params, "inactive")),
        }
        key = (handle, entry["role"])
        if key in seen:
            continue
        seen.add(key)

        # Coaches/managers/analysts land in staff, everyone else roster
        if any(w in role for w in ("coach", "manager", "analyst", "staff")):
            staff.append(entry)
        else:
            players.append(entry)

    return players, staff


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inspect", metavar="TEAM", help="Dump one page's raw wikitext and exit")
    ap.add_argument("--teams", nargs="*", help="Only these teams (default: all in --team-list)")
    ap.add_argument("--team-list", default="../src/lib/teamLogos.json",
                    help="JSON file whose top-level keys are team names")
    ap.add_argument("--out", default="../data_prep/liquipedia_rosters.json")
    ap.add_argument("--no-cache", action="store_true", help="Ignore the on-disk cache")
    args = ap.parse_args()

    session = make_session()
    here = os.path.dirname(os.path.abspath(__file__))

    if args.inspect:
        title = page_title(args.inspect)
        print(f"# page title: {title}", file=sys.stderr)
        text = fetch_wikitext(session, title, use_cache=not args.no_cache)
        if text is None:
            sys.exit(f"No such page: {title}")
        print(text)
        return

    if args.teams:
        teams = args.teams
    else:
        with open(os.path.join(here, args.team_list), encoding="utf-8") as f:
            teams = sorted(json.load(f).keys())

    out = {
        "_meta": {
            "source": "Liquipedia Valorant Wiki",
            "sourceUrl": "https://liquipedia.net/valorant",
            "license": "CC-BY-SA 3.0",
            "attribution": ATTRIBUTION,
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "teams": {},
    }

    missing = []
    for team in teams:
        title = page_title(team)
        print(f"[{team}] -> {title}")
        text = fetch_wikitext(session, title, use_cache=not args.no_cache)
        if text is None:
            print("  MISSING page")
            missing.append(team)
            continue
        players, staff = extract_roster(text)
        print(f"  {len(players)} players, {len(staff)} staff")
        out["teams"][team] = {
            "page": title,
            "url": f"https://liquipedia.net/valorant/{title.replace(' ', '_')}",
            "players": players,
            "staff": staff,
        }

    dest = os.path.join(here, args.out)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {dest}: {len(out['teams'])} teams")
    if missing:
        print(f"MISSING pages ({len(missing)}) -- add them to TEAM_PAGES: {missing}")


if __name__ == "__main__":
    main()
