#!/usr/bin/env python3
"""
Scrape VCT group-stage/bracket STRUCTURE (not results) from Liquipedia's
Valorant wiki: which teams are in which group, the official tiebreaker
rule chain, rank->advancement outcomes, and Play-Ins/Playoffs bracket
topology (seed placeholders).

WHY STRUCTURE ONLY, NOT RESULTS
--------------------------------
This site already has real, accurate match results for every VCT match
(scraped from VLR -- see export_from_db.py / public/data/match_results.json,
which carries per-match series scores AND per-map round scores). Liquipedia
is only needed for the things VLR doesn't publish: group composition, the
exact tiebreaker order (including a recursive subgroup-splitting rule not
derivable from raw standings), and bracket seeding rules. Confirmed by
inspecting real wikitext: actual match results are pulled from Liquipedia's
own LPDB at render time and are NOT present in a page's raw wikitext at all
-- so trying to scrape results from here would need action=parse (rendered
HTML, 30s/request) for data this site already has more reliably. Only
`action=query&prop=revisions` (raw wikitext, 2s/request) is used.

COMPLIANCE CHECKLIST (same as liquipedia_roster_scraper.py -- see that
file's own header for the full rationale)
------------------------------------------------------------------------
  * Custom User-Agent identifying the project + contact info.
  * >= 2s between requests (REQUEST_DELAY = 2.5s).
  * Results cached to disk (CACHE_TTL_HOURS).
  * Liquipedia content is CC-BY-SA 3.0 -- output carries a _meta.attribution
    string the site must render wherever this data is displayed.

USAGE
-----
  python3 liquipedia_tournament_scraper.py --inspect vct-2026-americas-stage-2
      Fetch one target stage and print its parsed structure without writing.

  python3 liquipedia_tournament_scraper.py --out ../public/data/tournament_structure.json
      Scrape every stage in TARGET_STAGES and write the structure JSON.

  python3 liquipedia_tournament_scraper.py --stages vct-2026-americas-stage-2
      Only this stage.
"""

import argparse
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
CACHE_TTL_HOURS = 24
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".liquipedia_tournament_cache")

ATTRIBUTION = (
    "Tournament structure (groups, tiebreaker rules, bracket seeding) from "
    "Liquipedia (liquipedia.net), licensed CC-BY-SA 3.0."
)

OVERRIDES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "liquipedia_tournament_overrides.json")

# ---------------------------------------------------------------------------
# Only currently-live/incomplete stages get built -- qualifying odds only
# mean anything while a stage's group round-robin isn't finished, and a
# finished stage's REAL results already come from this site's own VLR data,
# not from here. A new event needs a code edit (same accepted tradeoff the
# VLR scrapers' own hardcoded VCT_2026_EVENTS already makes -- arguably
# correct for an unattended job, not something you want auto-discovering
# targets without supervision).
#
# `slug` is each stage's exact public/data/events.json `slug` field (already
# a stable, hyphenated join key this site generates at export time -- no
# need to invent a parallel slug scheme). Confirmed directly against a real
# copy of events.json before hardcoding, same diligence as the page titles.
# ---------------------------------------------------------------------------
TARGET_STAGES = [
    {
        "slug": "vct-2026-americas-stage-2",
        "displayName": "Americas Stage 2 2026",
        "overviewPage": "VCT/2026/Americas League/Stage 2",
        "groupPage": "VCT/2026/Americas League/Stage 2/Group Stage",
    },
    {
        "slug": "vct-2026-emea-stage-2",
        "displayName": "EMEA Stage 2 2026",
        "overviewPage": "VCT/2026/EMEA League/Stage 2",
        "groupPage": "VCT/2026/EMEA League/Stage 2/Group Stage",
    },
    {
        "slug": "vct-2026-pacific-stage-2",
        "displayName": "Pacific Stage 2 2026",
        "overviewPage": "VCT/2026/Pacific League/Stage 2",
        "groupPage": "VCT/2026/Pacific League/Stage 2/Group Stage",
    },
    {
        "slug": "vct-2026-china-stage-2",
        "displayName": "China Stage 2 2026",
        "overviewPage": "VCT/2026/China League/Stage 2",
        "groupPage": "VCT/2026/China League/Stage 2/Group Stage",
    },
]

# ---------------------------------------------------------------------------
# Liquipedia's team-page/template names don't always match this site's own
# canonical spelling (VLR-derived, see export_from_db.py's
# CANONICAL_OVERRIDES). Same mapping liquipedia_roster_scraper.py already
# maintains (site name -> Liquipedia name); inverted here since group
# tables list the LIQUIPEDIA-side spelling and we need to resolve back to
# what this site's own team_buckets.json calls that team. Copied rather
# than imported, matching this scraper directory's standalone-file
# convention -- keep in sync with liquipedia_roster_scraper.py's own
# TEAM_PAGES if either changes.
# ---------------------------------------------------------------------------
SITE_TO_LIQUIPEDIA_NAME = {
    "LEVIATÁN": "Leviatán",
    "FNATIC": "Fnatic",
    "JDG Esports": "JD Gaming",
    "KIWOOM DRX": "DRX",
    "ENVY": "Envy",
    # Found live: group tables spell these two differently than either
    # site's own canonical name -- confirmed by diffing every parsed team
    # name against team_buckets.json's real team set after the first run.
    "Gen.G": "Gen.G Esports",
    "Xi Lai Gaming": "XLG Esports",
}
LIQUIPEDIA_TO_SITE_NAME = {v: k for k, v in SITE_TO_LIQUIPEDIA_NAME.items()}


def canonical_team_name(liquipedia_name):
    return LIQUIPEDIA_TO_SITE_NAME.get(liquipedia_name, liquipedia_name)


# ---------------------------------------------------------------------------
# HTTP (identical pattern to liquipedia_roster_scraper.py's make_session/
# fetch_wikitext -- copied rather than imported, see that file's own note on
# why this scraper directory favors standalone files over cross-imports)
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
# Wikitext parsing
# ---------------------------------------------------------------------------
def parse_templates(text: str):
    """
    Yield (name, params) for every {{...}} template, including nested ones.
    Params are the named ones only. Brace-depth aware (not regex) so a
    template value that itself contains a nested {{...}} -- e.g. a Bracket
    template's |r1m1={{Match|...}} -- stays intact as one param value
    instead of being split on the nested template's own internal pipes.

    Identical logic to liquipedia_roster_scraper.py's parse_templates
    (copied, not imported -- see that file's own docstring for why this
    scraper directory favors standalone files).
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

            name = re.split(r"[\n{|]", parts[0], 1)[0].strip()
            params = {}
            for p in parts[1:]:
                if "=" in p:
                    key, _, val = p.partition("=")
                    params[key.strip().lower()] = val.strip()
            yield name, params
            yield from parse_templates(body)
            i = j
        else:
            i += 1


def clean(v):
    """Strip wiki markup (links, italics, HTML tags) from a text fragment.
    Same helper as liquipedia_roster_scraper.py's clean()."""
    if v is None:
        return None
    v = re.sub(r"\[\[(?:[^\|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"''+", "", v)
    v = re.sub(r"<[^>]+>", "", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v or None


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")


def find_template_body(text, name):
    """Body of the first {{name ...}} template, brace-depth aware. Returns
    None if absent. Same helper as liquipedia_roster_scraper.py's."""
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
    return None


def parse_group_tables(group_wikitext):
    """
    Every {{GroupTableLeague|title=...|team1=...|team2=...|...}} block ->
    {group_title: {"teams": [canonical_name, ...]}}. Team LISTING order in
    the wikitext is draw-seed order, not live standings -- this site
    computes its own rank from real match_results.json data (see
    qualifyingOdds.js), so only WHICH teams are in the group matters here,
    not their wikitext position.
    """
    groups = {}
    for name, params in parse_templates(group_wikitext):
        if name != "GroupTableLeague":
            continue
        title = clean(params.get("title")) or f"Group {len(groups) + 1}"
        teams = []
        i = 1
        while f"team{i}" in params:
            raw = clean(params[f"team{i}"])
            if raw:
                teams.append(canonical_team_name(raw))
            i += 1
        if teams:
            groups[title] = {"teams": teams}
    return groups


TIEBREAK_VOCAB = {
    "head-to-head match score": "h2h_match_score",
    "head-to-head map differential": "h2h_map_diff",
    "head-to-head round differential": "h2h_round_diff",
    "map differential": "map_diff",
    "round differential": "round_diff",
    # EMEA Stage 2 2026 uniquely has a 6th criterion beyond the other three
    # regions' 5-step chain -- confirmed real, not a parsing artifact, by
    # running --inspect and finding this exact phrase in the live wikitext.
    # qualifyingOdds.js's rankGroupStandings does not implement real SoV
    # computation (documented gap, not silently ignored): it treats this
    # criterion as unable to separate anyone and falls through, since SoV is
    # a rare last-resort tier and getting its exact formula right needs a
    # dedicated follow-up rather than a guess baked into the ranking engine.
    "strength of victory (sov) score": "sov_score",
}


def parse_tiebreakers(overview_wikitext):
    """
    The prose "Tiebreaker rules:" ordered list is the authoritative,
    complete chain (the compact `tiebreakerN=` GroupTableLeague params are
    a lossy summary of the same thing -- e.g. Americas Stage 2's params
    only list 4 of the real 5 steps). Each line mapped to a canonical key
    via TIEBREAK_VOCAB; an unrecognized line is kept as a slugified
    fallback with a printed warning rather than silently dropped or
    misparsed -- defensive against future wording drift.
    """
    m = re.search(r"Tiebreaker rules:'''\s*\n((?:\*#.+\n?)+)", overview_wikitext)
    if not m:
        print("  [warn] no 'Tiebreaker rules' section found")
        return []
    lines = re.findall(r"\*#(.+)", m.group(1))
    order = []
    for line in lines:
        text = clean(line) or ""
        key = TIEBREAK_VOCAB.get(text.lower())
        if key is None:
            print(f"  [warn] unrecognized tiebreaker phrase: {text!r}")
            key = slugify(text)
        order.append(key)
    return order


ORDINAL_RE = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b")


TOP_N_RE = re.compile(r"\btop (\d+)\b")


def ordinals_in(text):
    """'Winners' -> [1]; '2nd placed teams' -> [2]; '3rd & 4th placed
    teams' -> [3, 4] (a range spanning every ordinal found, since VCT
    always phrases multi-rank buckets as a contiguous 'Xth & Yth' or
    'Xth - Yth' pair, never a disjoint set); 'Top 2 teams' -> [1, 2].

    'Top N' matters for real, not just completeness: China Stage 2 2026's
    own Format text describes its top bracket purely as "Top 2 teams...
    advance to Playoffs" with no separate "Winners"/"2nd placed" breakdown
    the way Americas/EMEA/Pacific have -- without this branch, ranks 1 and
    2 silently got NO outcome at all for China (caught by diffing parsed
    output against the manually-read wikitext, not assumed correct). Safe
    for the other three regions too: their own "Top 2 teams... advance to
    Playoffs" summary bullet sets ranks 1-2 to this same generic text
    first, and the more specific "Winners"/"2nd placed" bullets that follow
    it in document order correctly overwrite it (bullets are processed in
    the order they appear, later assignments win) -- verified live, not
    just reasoned about, against real Americas output.
    """
    t = (text or "").lower()
    if "winner" in t:
        return [1]
    top_m = TOP_N_RE.search(t)
    if top_m:
        return list(range(1, int(top_m.group(1)) + 1))
    nums = sorted(int(n) for n in ORDINAL_RE.findall(t))
    if len(nums) >= 2:
        return list(range(min(nums), max(nums) + 1))
    return nums


def parse_seed_outcomes(group_wikitext):
    """
    Every {{Bgcolortext|color|LABEL}} rest-of-bullet-text pair under
    ==Format== -> {rank: {"slug": ..., "text": ...}}. This is STAGE-level
    (not per-group) -- every group in a stage shares the same advancement
    rule ("Top 2 teams from each group advance..."), confirmed identical
    across Americas/EMEA/Pacific's own Format sections. China's own Format
    text uses genuinely different rank buckets (both top-2 seeds get a bye,
    not just rank 1) -- this parses each stage's own wording independently
    rather than assuming any fixed shape.

    Deliberately parses the GROUP-STAGE SUBPAGE's own Format section, not
    the stage overview page's -- the overview page's Format section lists
    THREE separate rank-1/2/3-4/etc bullet blocks back to back (Group
    Stage advancement, then Play-Ins advancement, then Playoffs
    advancement), all reusing the same small rank numbers with different
    meanings each time. A flat rank-keyed dict scanning the whole overview
    page silently let the LATER Play-Ins block's "3rd & 4th start from
    Lower Bracket Round 1" overwrite the group stage's real "3rd & 4th
    advance to Play-Ins Upper Bracket Round 2" -- caught by running
    --inspect against the real page and comparing output to the manually
    fetched wikitext, not assumed correct from the code alone. The group
    subpage's own Format section only ever contains the group-stage
    bullets, so parsing from there is correct by construction instead of
    needing fragile section-boundary matching against the overview page.
    """
    outcomes = {}
    for m in re.finditer(r"\{\{Bgcolortext\|[^|]+\|([^}]+)\}\}([^\n]*)", group_wikitext):
        label = clean(m.group(1)) or ""
        rest = clean(m.group(2).lstrip(":").strip()) or ""
        ranks = ordinals_in(label)
        if not ranks:
            continue
        slug = slugify(rest)
        for r in ranks:
            outcomes[str(r)] = {"slug": slug, "text": rest}
    return outcomes


def parse_bracket_skeleton(overview_wikitext):
    """
    {{Bracket|...}} blocks under ==={{Stage|Play-Ins}}=== / Playoffs ->
    {"playIns": {...}, "playoffs": {...}}, each a flat list of
    {round, match, opponent1, opponent2} using Liquipedia's own seed
    placeholder labels ("Alpha #3", "Play-Ins #1-2") -- real team
    resolution is intentionally out of scope this pass (see
    src/components/BracketTree.jsx's own comment).
    """
    brackets = {}
    for stage_key, out_key in (("Play-Ins", "playIns"), ("Playoffs", "playoffs")):
        section_m = re.search(
            r"==={{Stage\|" + re.escape(stage_key) + r"}}===(.*?)(?===={|\Z)",
            overview_wikitext, re.DOTALL,
        )
        if not section_m:
            continue
        body = find_template_body(section_m.group(1), "Bracket")
        if body is None:
            continue
        # Re-wrap so the same brace-aware param parser used everywhere else
        # here handles the nested {{Match|...}} values correctly.
        _, bracket_params = next(parse_templates("{{Bracket|" + body + "}}"))
        matches = []
        for key, value in bracket_params.items():
            m = re.match(r"^r(\d+)m(\d+)$", key)
            if not m or "{{" not in value:
                continue
            nested = list(parse_templates(value))
            if not nested or nested[0][0].lower() != "match":
                continue
            match_params = nested[0][1]
            matches.append({
                "round": int(m.group(1)),
                "match": int(m.group(2)),
                "opponent1": clean(match_params.get("opponent1literal")),
                "opponent2": clean(match_params.get("opponent2literal")),
            })
        matches.sort(key=lambda x: (x["round"], x["match"]))
        brackets[out_key] = matches
    return brackets


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        return {}
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        return json.load(f)


def scrape_stage(session, stage_cfg, use_cache=True):
    slug = stage_cfg["slug"]
    print(f"[{slug}]")
    overview = fetch_wikitext(session, stage_cfg["overviewPage"], use_cache=use_cache)
    if overview is None:
        print(f"  [FAILED] overview page missing: {stage_cfg['overviewPage']}")
        return None
    group_page = fetch_wikitext(session, stage_cfg["groupPage"], use_cache=use_cache)
    if group_page is None:
        print(f"  [FAILED] group page missing: {stage_cfg['groupPage']}")
        return None

    groups = parse_group_tables(group_page)
    tiebreakers = parse_tiebreakers(overview)
    seed_outcomes = parse_seed_outcomes(group_page)
    brackets = parse_bracket_skeleton(overview)

    if not groups:
        print("  [warn] no groups parsed")
    if not tiebreakers:
        print("  [warn] no tiebreaker order parsed")

    overrides = load_overrides().get(slug, {})
    result = {
        "displayName": stage_cfg["displayName"],
        "groups": groups,
        "tiebreakers": tiebreakers,
        "seedOutcomes": seed_outcomes,
        "brackets": brackets,
    }
    result.update(overrides)
    print(f"  groups={list(groups.keys())} tiebreakers={tiebreakers}")
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stages", nargs="*", help="Subset of TARGET_STAGES slugs to scrape")
    ap.add_argument("--inspect", metavar="SLUG", help="Fetch+parse one stage, print, don't write")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "tournament_structure.json"))
    args = ap.parse_args()

    session = make_session()
    use_cache = not args.no_cache

    if args.inspect:
        cfg = next((s for s in TARGET_STAGES if s["slug"] == args.inspect), None)
        if not cfg:
            sys.exit(f"Unknown stage slug: {args.inspect}")
        result = scrape_stage(session, cfg, use_cache=use_cache)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    targets = TARGET_STAGES
    if args.stages:
        targets = [s for s in TARGET_STAGES if s["slug"] in args.stages]

    out_path = os.path.abspath(args.out)

    # Merge into whatever's already on disk rather than overwrite wholesale
    # -- a `--stages` subset run (or one stage's fetch failing this run)
    # must not silently wipe every OTHER stage's already-good data. Caught
    # live: an EMEA-only `--stages` rerun (to test the tiebreaker vocab fix)
    # clobbered the prior full run's Americas/Pacific/China entries before
    # this fix, confirmed by re-reading the file and finding only 1 of 4
    # stages left.
    stages = {}
    if os.path.exists(out_path):
        try:
            with open(out_path, encoding="utf-8") as f:
                stages = json.load(f).get("stages", {})
        except (json.JSONDecodeError, OSError):
            stages = {}

    for cfg in targets:
        result = scrape_stage(session, cfg, use_cache=use_cache)
        if result:
            stages[cfg["slug"]] = result

    out = {
        "_meta": {
            "source": "Liquipedia",
            "license": "CC-BY-SA 3.0",
            "attribution": ATTRIBUTION,
        },
        "stages": stages,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {len(stages)} stage(s) to {out_path}")


if __name__ == "__main__":
    main()
