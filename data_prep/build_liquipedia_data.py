#!/usr/bin/env python3
"""
Build public/data/liquipedia_rosters.json -- either straight from the
Liquipedia API (--fetch, the automated path) or from a directory of
team pages already fetched via liquipedia_roster_scraper.py's
--dump-html (--html-dir, for local offline iteration without waiting
on the API's 30s/request action=parse rate limit every time).

This is the step that turns raw per-team extraction (extract_roster_
from_html's output: active/inactive/former players, all coaching/staff
roles, real names) into the shape the site actually consumes: STARTER/
BENCHED/other player status (VLR-style terminology; see
derive_player_status for how a real Substitute/Loan/etc. note in that
same slot takes priority), a separate formerPlayers list, a per-team
timeline (players + coaches, every status, for the roster timeline
chart), and manual corrections applied on top for real-world changes
Liquipedia hasn't caught up to yet (liquipedia_overrides.json).

This used to be redone from scratch as a throwaway script every time a
correction was needed, which meant no single reproducible path from
"fetched HTML" to "the file the site reads" -- fixed by committing this
version instead. It was ALSO, until this revision, a genuinely two-step
manual process even when reproducible (someone had to run
--dump-html/--html full-run by hand, save the output into a directory,
then run this script against that directory) -- --fetch below collapses
that into the one command CI actually runs.

USAGE
-----
  python3 build_liquipedia_data.py --fetch \\
      --out ../public/data/liquipedia_rosters.json
      (needs LIQUIPEDIA_CONTACT set -- see liquipedia_roster_scraper.py.
      Full run is ~48-55 teams x 32s/request (action=parse's own rate
      limit) -- budget ~25-30 minutes.)

  python3 build_liquipedia_data.py --html-dir /path/to/team_htmls \\
      --out ../public/data/liquipedia_rosters.json

  Each file in --html-dir should be named after its Liquipedia page
  title (spaces or underscores both fine, e.g. "Leviatán.html" or
  "JD_Gaming.html") -- matched back to this site's canonical VLR team
  names via the same TEAM_PAGES/DEFAULT_TEAMS mapping the scraper uses.
"""

import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scraper"))
from liquipedia_roster_scraper import (  # noqa: E402
    extract_roster_from_html, DEFAULT_TEAMS, page_title, ATTRIBUTION,
    make_session, fetch_parsed_html,
)

OVERRIDES_PATH = os.path.join(HERE, "..", "scraper", "liquipedia_overrides.json")


def decode_hash_u(s):
    """Some HTML-export tools encode non-ASCII filename characters as
    #Uxxxx (hex codepoint) rather than the literal character."""
    return re.sub(r"#U([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def match_files_to_teams(html_dir):
    expected = {norm(page_title(t)): t for t in DEFAULT_TEAMS}
    matched, unmatched = {}, []
    for f in glob.glob(os.path.join(html_dir, "*.html")):
        base = os.path.splitext(os.path.basename(f))[0]
        key = norm(decode_hash_u(base))
        if key in expected:
            matched[expected[key]] = f
        else:
            unmatched.append(base)
    return matched, unmatched


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        return {}
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        data = json.load(f)
    data.pop("_comment", None)
    return data


def derive_player_status(status, position):
    """
    STARTER/BENCHED is Liquipedia's own Active/Inactive table split (see
    module docstring) -- but some rows carry a `position` note in that
    table's own blank-header column too (most commonly "Substitute";
    Liquipedia reuses the same slot for other real distinctions like
    "Loan" or "Trial" on other teams). That note wins over the plain
    active/inactive split whenever present: a two-way STARTER/BENCHED
    badge can't represent "on the active roster, but plays substitute
    rather than starter" (real case: FULL SENSE's Leviathan, active +
    position="Substitute"), and collapsing it to STARTER would be wrong.
    Uppercased to match STARTER/BENCHED's own convention; whatever text
    Liquipedia uses becomes the badge label as-is, so this generalizes to
    values beyond "Substitute" with no code change needed per team.
    """
    if position:
        return position.strip().upper()
    return "STARTER" if status == "active" else "BENCHED"


def build_team_entry(html, overrides_for_team):
    result = extract_roster_from_html(html)

    active_raw = [p for p in result["players"] if p["status"] == "active"]
    inactive_raw = [p for p in result["players"] if p["status"] == "inactive"]
    former_raw = [p for p in result["players"] if p["status"] == "former"]

    players = []
    for p in active_raw + inactive_raw:
        players.append({**p, "playerStatus": derive_player_status(p["status"], p.get("position"))})

    # Manual overrides applied last, so they always win over whatever
    # Liquipedia's page currently says -- for real-world changes
    # Liquipedia hasn't been updated to reflect yet. Matched
    # case-insensitively by handle.
    #
    # `vlrId` is a second override kind, distinct from `playerStatus`:
    # RosterTable.jsx joins this file's players against the site's own
    # VLR-derived stats by exact (lowercased) handle, and VLR and
    # Liquipedia occasionally disagree on what a player's handle even IS
    # for the same real person -- confirmed real cases, not guesses (same
    # team, same country/flag, near-identical handle): LEVIATÁN's
    # spikeziN (Liquipedia) is VLR's "spike", Bilibili Gaming's whz
    # (Liquipedia, "Wang Haozhe") is VLR's "whzy". Liquipedia's `id` is
    # otherwise never shown to the user for players (only used as this
    # join key), so rewriting it to match VLR's handle is safe -- it
    # doesn't change anything else about the player's displayed data.
    # Without this, RosterTable.jsx's whitelist join silently drops the
    # player entirely: real match stats, current Liquipedia STARTER
    # status, but absent from the team page with no error or indication
    # why.
    override_by_id = {k.lower(): v for k, v in overrides_for_team.items()}
    for row in players:
        ov = override_by_id.get(row["id"].lower())
        if ov and "playerStatus" in ov:
            row["playerStatus"] = ov["playerStatus"]
        if ov and "vlrId" in ov:
            row["id"] = ov["vlrId"]

    players_out = [
        {
            "id": p["id"], "name": p["name"], "joinDate": p["joinDate"],
            "flag": p["flag"], "captain": p["captain"],
            "playerStatus": p["playerStatus"],
        }
        for p in players
    ]

    former_players = [
        {
            "id": p["id"], "name": p["name"], "joinDate": p["joinDate"],
            "leaveDate": p.get("leaveDate"), "newTeam": p.get("newTeam"),
            "flag": p["flag"],
        }
        for p in former_raw
    ]

    coaches = [
        {"id": c["id"], "name": c["name"], "role": c["role"],
         "joinDate": c["joinDate"], "flag": c["flag"]}
        for c in result["coaches"] if c["status"] == "active"
    ]

    timeline = []
    for p in result["players"]:
        timeline.append({
            "id": p["id"], "name": p["name"], "type": "player",
            "status": p["status"], "joinDate": p["joinDate"],
            "leaveDate": p.get("leaveDate"),
        })
    for c in result["coaches"]:
        timeline.append({
            "id": c["id"], "name": c["name"], "type": "coach",
            "status": c["status"], "joinDate": c["joinDate"],
            "leaveDate": c.get("leaveDate"),
        })

    return {
        "players": players_out,
        "formerPlayers": former_players,
        "coaches": coaches,
        "timeline": timeline,
    }


def fetch_team_html(teams, no_cache=False):
    """
    Direct API-fetch counterpart to match_files_to_teams: {team: html}
    for every team in `teams`, going through the exact same
    make_session/fetch_parsed_html path liquipedia_roster_scraper.py's
    own --dump-html uses (compliant User-Agent, 32s/request action=parse
    throttle, on-disk cache with a 24h TTL) rather than duplicating any
    of that. Returns (matched, missing) the same shape match_files_to_
    teams returns (matched, unmatched), so main() doesn't need to know
    which source produced the html.
    """
    session = make_session()
    matched, missing = {}, []
    for i, team in enumerate(teams, 1):
        title = page_title(team)
        print(f"[{i}/{len(teams)}] [{team}] -> {title}")
        html = fetch_parsed_html(session, title, use_cache=not no_cache)
        if html is None:
            print("  MISSING page")
            missing.append(team)
            continue
        matched[team] = html
    return matched, missing


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--fetch", action="store_true",
                      help="Fetch every team directly from the Liquipedia API (needs LIQUIPEDIA_CONTACT) "
                           "instead of reading pre-fetched HTML from --html-dir. The automated/CI path.")
    src.add_argument("--html-dir", help="Directory of pre-fetched team HTML pages (see liquipedia_roster_scraper.py --dump-html)")
    ap.add_argument("--teams", nargs="*", help="With --fetch: only these teams (default: all in DEFAULT_TEAMS)")
    ap.add_argument("--no-cache", action="store_true", help="With --fetch: ignore the on-disk API cache")
    ap.add_argument("--out", default="../public/data/liquipedia_rosters.json")
    args = ap.parse_args()

    if args.fetch:
        matched, unmatched = fetch_team_html(args.teams or DEFAULT_TEAMS, no_cache=args.no_cache)
    else:
        matched_paths, unmatched = match_files_to_teams(args.html_dir)
        # match_files_to_teams returns {team: path}, not {team: html} --
        # normalize here so the build loop below is identical either way.
        matched = {
            team: open(path, encoding="utf-8", errors="replace").read()
            for team, path in matched_paths.items()
        }

    overrides = load_overrides()

    out = {
        "_meta": {
            "source": "Liquipedia Valorant Wiki",
            "sourceUrl": "https://liquipedia.net/valorant",
            "license": "CC-BY-SA 3.0",
            "attribution": ATTRIBUTION,
        },
        "teams": {},
    }

    status_counts = {}
    for team, html in matched.items():
        entry = build_team_entry(html, overrides.get(team, {}))
        out["teams"][team] = entry
        for p in entry["players"]:
            status_counts[p["playerStatus"]] = status_counts.get(p["playerStatus"], 0) + 1
        print(f"[{team}] {sum(1 for p in entry['players'] if p['playerStatus']=='STARTER')} starter, "
              f"{sum(1 for p in entry['players'] if p['playerStatus']=='BENCHED')} benched, "
              f"{len(entry['formerPlayers'])} former, {len(entry['coaches'])} coaches")

    dest = os.path.join(HERE, args.out)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {dest}: {len(out['teams'])} teams")
    print("Status breakdown:", status_counts)
    if unmatched:
        label = "MISSING pages" if args.fetch else "UNMATCHED files -- check TEAM_PAGES"
        print(f"{label} ({len(unmatched)}): {unmatched}")
    missing_teams = set(DEFAULT_TEAMS) - set(matched.keys())
    if missing_teams:
        print(f"Teams with no data ({'not fetched' if args.fetch else 'no HTML file provided'}): {sorted(missing_teams)}")


if __name__ == "__main__":
    main()
