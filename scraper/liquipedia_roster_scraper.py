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
from bs4 import BeautifulSoup

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
PARSE_REQUEST_DELAY = 32  # action=parse is limited to 1 req/30s, not 1/2s -- extra headroom
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


def cache_path(title: str, ext: str = "wikitext") -> str:
    safe = re.sub(r"[^\w.-]", "_", title)
    return os.path.join(CACHE_DIR, f"{safe}.{ext}")


def read_cache(title: str, ext: str = "wikitext"):
    p = cache_path(title, ext)
    if not os.path.exists(p):
        return None
    age_h = (time.time() - os.path.getmtime(p)) / 3600
    if age_h > CACHE_TTL_HOURS:
        return None
    with open(p, encoding="utf-8") as f:
        return f.read()


def write_cache(title: str, text: str, ext: str = "wikitext") -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(title, ext), "w", encoding="utf-8") as f:
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


def fetch_parsed_html(session, title: str, use_cache=True):
    """
    Rendered HTML for a page via action=parse, or None if it doesn't
    exist.

    This is the piece that raw wikitext (fetch_wikitext, action=query)
    can't give us: action=parse actually EXECUTES the page's Lua
    modules server-side, the same as visiting the page in a browser
    would trigger. Confirmed against Leviatán's page that at least one
    part of the Organization table (Onur/Jhein/Boia) is assembled at
    render time from the Infobox's coaches=/manager= fields plus
    ActiveOrganizationAuto -- neither of which show that merged result
    in their own wikitext. Whether action=parse's output *also* resolves
    whatever produces Tostado/LRojo/雨童 (which have no wikitext trace
    anywhere on the page, and no personal page to auto-resolve from
    either) is the open question this function exists to test -- if
    those genuinely come from Liquipedia's internal LPDB rather than
    anything at all reachable by rendering THIS page's own wikitext,
    action=parse won't surface them either, since it's still bounded by
    what this one page's templates can pull in.

    Rate-limited far more conservatively than fetch_wikitext:
    action=parse is explicitly called out in Liquipedia's ToU as more
    resource-intensive, capped at 1 request / 30 seconds versus the
    general 1 / 2 seconds -- PARSE_REQUEST_DELAY (32s) respects that.
    """
    if use_cache:
        cached = read_cache(title, ext="html")
        if cached is not None:
            return cached

    params = {
        "action": "parse",
        "format": "json",
        "page": title,
        "prop": "text",
        "redirects": 1,
    }
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(API, params=params, timeout=30)
            if r.status_code == 200:
                time.sleep(PARSE_REQUEST_DELAY)
                data = r.json()
                if "error" in data:
                    code = data["error"].get("code")
                    if code in ("missingtitle",):
                        return None
                    print(f"  [api error] {title}: {data['error']}")
                    return None
                html = data.get("parse", {}).get("text", {}).get("*")
                if not html:
                    return None
                write_cache(title, html, ext="html")
                return html
            if r.status_code == 429:
                wait = 60 * attempt  # action=parse is the resource-intensive one; back off harder
                print(f"  [429] rate limited on {title} (parse); sleeping {wait}s")
                time.sleep(wait)
                continue
            print(f"  [{r.status_code}] {title} (parse, attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {title} (parse): {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    print(f"  [FAILED] {title} (parse)")
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


SQUAD_AUTO_ROW = re.compile(r"\{\{SquadAutoRow\|([^}]*)\}\}")


def parse_named_args(arg_str):
    """{{SquadAutoRow|a=1|b=2}}'s inner string -> {"a": "1", "b": "2"}."""
    out = {}
    for part in arg_str.split("|"):
        if "=" in part:
            k, _, v = part.partition("=")
            out[k.strip().lower()] = v.strip()
    return out


def extract_infobox_field(wikitext, field):
    """
    |coaches=, |manager=, |igl= aren't templates -- they're plain Infobox
    field values containing {{Flag|xx}} + [[PlayerName]] pairs (possibly
    several, <br>-separated). Returns a list of {"flag": ..., "name": ...}.
    """
    m = re.search(rf"\|\s*{field}\s*=\s*(.+)", wikitext)
    if not m:
        return []
    # Field value runs to end of line (Infobox params are one per line)
    value = m.group(1).split("\n")[0]
    people = []
    for chunk in re.split(r"<br\s*/?>", value):
        flag_m = re.search(r"\{\{Flag\|(\w+)\}\}", chunk, re.I)
        name_m = re.search(r"\[\[([^\|\]]+)(?:\|[^\]]*)?\]\]", chunk)
        if name_m:
            people.append({
                "id": name_m.group(1).strip(),
                "flag": flag_m.group(1).lower() if flag_m else None,
            })
    return people


def find_template_body(text, name):
    """
    Body of the first {{name ...}} template, brace-depth aware so
    nested templates (SquadAutoRow rows inside a wrapper) don't confuse
    it, and so a template with NO body at all ({{FormerSquadAuto}},
    closing immediately with no args) correctly returns "" rather than
    a regex scanning forward past it into unrelated content -- which is
    exactly what broke the first version of this against real data:
    an empty {{FormerSquadAuto}} matched all the way to the NEXT
    wrapper's closing brace instead.

    Returns None if the template isn't present at all, "" if present
    but empty, or the body string otherwise.
    """
    start = re.search(r"\{\{\s*" + re.escape(name) + r"\b", text)
    if not start:
        return None
    i = start.end()
    depth = 1
    while i < len(text) - 1:
        if text[i] == "{" and text[i + 1] == "{":
            depth += 1
            i += 2
            continue
        if text[i] == "}" and text[i + 1] == "}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start.end():i - 2]
            continue
        i += 1
    return None  # unbalanced -- malformed page, treat as absent


def extract_section(wikitext, wrapper_name):
    """
    All {{SquadAutoRow|...}} rows nested inside {{wrapper_name ... }},
    e.g. wrapper_name="ActiveSquadAuto" or "FormerOrganizationAuto".
    Returns [] if the wrapper is empty or absent -- notably, this is
    EXPECTED for FormerSquadAuto on many team pages: unlike
    ActiveSquadAuto, it appears to auto-resolve from Liquipedia's
    internal database at render time rather than storing rows in the
    page's own wikitext, so an empty result there doesn't mean "no
    former players", it means "not recoverable this way".
    """
    body = find_template_body(wikitext, wrapper_name)
    if not body:
        return []
    return [parse_named_args(a) for a in SQUAD_AUTO_ROW.findall(body)]


def extract_roster_from_html(html: str):
    """
    Second, independent extraction path: parses action=parse's rendered
    HTML instead of raw wikitext, looking for the "Player Roster" and
    "Organization" tables directly by column headers rather than by
    template name -- there's no template name to key on once a page has
    already been rendered.

    Section-scoping is hierarchical and deliberately so: a naive "find
    any heading called Active" approach breaks, because "Active"/
    "Former" appear as h3 subheadings under BOTH the Player Roster AND
    Organization h2 sections. A synthetic-fixture test caught this
    concretely -- an early version matched "Active" generically and
    ended up pulling the Organization section's rows into the player
    list, and duplicating the player table (since it matched under both
    the h2 and its own nested h3). Fixed by finding the h2 section
    first, then only looking for Active/Former h3s bounded by THAT h2's
    own extent (up to the next h2).

    UNTESTED against a live fetch as of writing (same caveat as the rest
    of this file): written against the column-header set visible in the
    person's own screenshot (ID, Name, Status, Time on Team, Maps
    Played, Rating for players; ID, Name, Role, Join Date for
    organization), matching case-insensitively and tolerating missing
    columns -- but the exact table CSS classes/structure, and whether
    flag <img alt="..."> text is a country name or an ISO code, haven't
    been confirmed. Run --test-html-extract on one team first.
    """
    soup = BeautifulSoup(html, "html.parser")
    all_headings = soup.find_all(re.compile(r"^h[1-6]$"))

    def section_elements(h2_text):
        """Every tag between the named h2 and the next h2 (or end of
        page), i.e. that h2's full section including any h3 subheadings
        and their tables."""
        start = None
        for h in all_headings:
            if h.name == "h2" and h.get_text(strip=True).lower() == h2_text.lower():
                start = h
                break
        if start is None:
            return []
        out = []
        for sib in start.find_all_next():
            if sib.name == "h2":
                break
            out.append(sib)
        return out

    def tables_by_status(elements):
        """Within a section's elements, tag each table by whichever
        Active/Former h3 (or h4, some pages nest one level deeper) most
        recently preceded it. Defaults to "active" if no such heading
        appears before the first table (a page with only one status and
        no subheading at all)."""
        status = "active"
        out = []
        for el in elements:
            if re.match(r"^h[3-4]$", el.name or ""):
                text = el.get_text(strip=True).lower()
                if "former" in text:
                    status = "former"
                elif "active" in text:
                    status = "active"
            elif el.name == "table":
                out.append((el, status))
        return out

    def rows_by_header(table):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        if not headers:
            return []
        rows = []
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if not cells or len(cells) < 2:
                continue
            row = {h: clean(td.get_text(" ", strip=True)) for h, td in zip(headers, cells)}
            # NOT confirmed to be an ISO code -- Liquipedia flag images
            # commonly use the country NAME as alt text (e.g. alt=
            # "Argentina"), not a 2-letter code, unlike this site's own
            # Flag component which needs a code for flagcdn.com URLs.
            # Stored raw rather than guessed-converted; needs a real
            # sample to know whether a name->code lookup is required.
            flag_img = cells[0].find("img")
            row["_flag_raw"] = flag_img.get("alt") if flag_img else None
            rows.append(row)
        return rows

    players, staff = [], []
    for table, status in tables_by_status(section_elements("Player Roster")):
        for row in rows_by_header(table):
            pid = row.get("id") or row.get("player")
            if not pid:
                continue
            players.append({
                "id": pid,
                "status": status,
                "timeOnTeam": row.get("time on team"),
                "mapsPlayed": row.get("maps played"),
                "rating": row.get("rating"),
                "flagRaw": row.get("_flag_raw"),
            })

    for table, status in tables_by_status(section_elements("Organization")):
        for row in rows_by_header(table):
            pid = row.get("id")
            if not pid:
                continue
            staff.append({
                "id": pid,
                "name": row.get("name"),
                "role": row.get("role"),
                "joinDate": row.get("join date"),
                "status": status,
                "flagRaw": row.get("_flag_raw"),
            })

    coaches = [s for s in staff if s["role"] and "coach" in s["role"].lower()]
    return {"players": players, "staff": staff, "coaches": coaches}


def extract_roster(wikitext: str):
    """
    Real shape, confirmed against a live page (Leviatán, 2026-07-26) --
    see the module docstring for what's NOT recoverable this way.
    """
    active_players = extract_section(wikitext, "ActiveSquadAuto")
    former_players = extract_section(wikitext, "FormerSquadAuto")  # usually [] -- see above
    active_staff = extract_section(wikitext, "ActiveOrganizationAuto")
    former_staff = extract_section(wikitext, "FormerOrganizationAuto")

    igl_ids = {p["id"] for p in extract_infobox_field(wikitext, "igl")}

    players = []
    for row in active_players:
        pid = row.get("id")
        if not pid:
            continue
        players.append({
            "id": pid,
            "captain": row.get("captain") == "true",
            "igl": pid in igl_ids,
            "joinDate": row.get("joindate"),
            "leaveDate": None,
            "status": "active",
        })
    for row in former_players:
        pid = row.get("id")
        if not pid:
            continue
        players.append({
            "id": pid,
            "captain": row.get("captain") == "true",
            "igl": False,
            "joinDate": row.get("joindate"),
            "leaveDate": row.get("leavedate"),
            "status": "former",
        })

    staff = []
    for row, status in [(r, "active") for r in active_staff] + [(r, "former") for r in former_staff]:
        pid = row.get("id")
        if not pid:
            continue
        staff.append({
            "id": pid,
            "name": clean(row.get("name")),
            "flag": (row.get("flag") or "").lower() or None,
            "role": clean(row.get("role")),
            "joinDate": row.get("joindate") or None,
            "leaveDate": row.get("leavedate") or None,
            "status": status,
        })

    # Coaches: anyone in the Organization section whose role contains
    # "coach" (Head Coach, Assistant Coach, ...), not the Infobox
    # |coaches= field. The Organization table carries real join/leave
    # dates and full names; the Infobox field is just names. Confirmed
    # from the rendered page (not just the raw wikitext excerpt pasted
    # earlier, which didn't happen to include the coach rows) that
    # coaches live in ActiveOrganizationAuto/FormerOrganizationAuto
    # alongside CEO/manager/social-media-manager-type rows, distinguished
    # only by their role text -- there's no separate coach-only template.
    coaches = [s for s in staff if s["role"] and "coach" in s["role"].lower()]

    # Infobox |coaches=/|manager= kept as a fallback merge for any team
    # whose Organization section doesn't list coaches at all -- adds
    # anyone not already captured above, with only a name/flag (no
    # dates, since the infobox field doesn't have them).
    seen_coach_ids = {c["id"] for c in coaches}
    for person in extract_infobox_field(wikitext, "coaches"):
        if person["id"] not in seen_coach_ids:
            coaches.append({
                "id": person["id"], "name": None, "flag": person["flag"],
                "role": "Coach (from infobox, no Organization-section entry)",
                "joinDate": None, "leaveDate": None, "status": "active",
            })
            seen_coach_ids.add(person["id"])

    manager = extract_infobox_field(wikitext, "manager")

    return {
        "players": players,
        "staff": staff,
        "coaches": coaches,
        "manager": manager,
    }


# ---------------------------------------------------------------------------
def main():
    # Windows consoles default to a codepage like cp1252, which can't
    # represent every character these pages contain (Chinese handles,
    # certain accented names) -- and print() inherits that encoding even
    # when stdout is redirected to a file with `>`, since redirection
    # doesn't change what encoding Python thinks the stream wants.
    # Forcing UTF-8 here fixes it regardless of the OS/locale.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inspect", metavar="TEAM", help="Dump one page's raw wikitext and exit")
    ap.add_argument("--dump-html", metavar="TEAM", help="Dump one page's action=parse rendered HTML and exit")
    ap.add_argument("--test-html-extract", metavar="TEAM",
                    help="Fetch one page's rendered HTML, run extract_roster_from_html, print the result as JSON, and exit -- run this before a full --html run")
    ap.add_argument("--html", action="store_true",
                    help="Use action=parse (rendered HTML) instead of wikitext for the full run. Slower (32s/request vs 2.5s) but can surface Lua-module-merged content wikitext alone can't (see extract_roster_from_html's docstring)")
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

    if args.dump_html:
        title = page_title(args.dump_html)
        print(f"# page title: {title}", file=sys.stderr)
        html = fetch_parsed_html(session, title, use_cache=not args.no_cache)
        if html is None:
            sys.exit(f"No such page: {title}")
        print(html)
        return

    if args.test_html_extract:
        title = page_title(args.test_html_extract)
        print(f"# page title: {title}", file=sys.stderr)
        html = fetch_parsed_html(session, title, use_cache=not args.no_cache)
        if html is None:
            sys.exit(f"No such page: {title}")
        result = extract_roster_from_html(html)
        print(json.dumps(result, indent=2, ensure_ascii=False))
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
        if args.html:
            html = fetch_parsed_html(session, title, use_cache=not args.no_cache)
            if html is None:
                print("  MISSING page")
                missing.append(team)
                continue
            result = extract_roster_from_html(html)
            n_active = sum(1 for p in result["players"] if p["status"] == "active")
            print(f"  {n_active} active players, {len(result['staff'])} staff, "
                  f"{len(result['coaches'])} coaches")
        else:
            text = fetch_wikitext(session, title, use_cache=not args.no_cache)
            if text is None:
                print("  MISSING page")
                missing.append(team)
                continue
            result = extract_roster(text)
            n_active = sum(1 for p in result["players"] if p["status"] == "active")
            print(f"  {n_active} active players, {len(result['staff'])} staff, "
                  f"{len(result['coaches'])} coaches, {len(result['manager'])} manager")
        out["teams"][team] = {
            "page": title,
            "url": f"https://liquipedia.net/valorant/{title.replace(' ', '_')}",
            **result,
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
