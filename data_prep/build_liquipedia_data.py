#!/usr/bin/env python3
"""
Build public/data/liquipedia_rosters.json from a directory of Liquipedia
team pages already fetched via liquipedia_roster_scraper.py's --dump-html
(or --html full-run cache).

This is the step that turns raw per-team extraction (extract_roster_
from_html's output: active/inactive/former players, all coaching/staff
roles, real names) into the shape the site actually consumes: STARTER/
BENCHED player status (VLR terminology), a separate formerPlayers list,
a per-team timeline (players + coaches, every status, for the roster
timeline chart), and manual corrections applied on top for real-world
changes Liquipedia hasn't caught up to yet (liquipedia_overrides.json).

This used to be redone from scratch as a throwaway script every time a
correction was needed, which meant no single reproducible path from
"fetched HTML" to "the file the site reads" -- fixed by committing this
version instead.

USAGE
-----
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


def build_team_entry(html, overrides_for_team):
    result = extract_roster_from_html(html)

    active_raw = [p for p in result["players"] if p["status"] == "active"]
    inactive_raw = [p for p in result["players"] if p["status"] == "inactive"]
    former_raw = [p for p in result["players"] if p["status"] == "former"]

    players = []
    for p in active_raw:
        players.append({**p, "playerStatus": "STARTER"})
    for p in inactive_raw:
        players.append({**p, "playerStatus": "BENCHED"})

    # Manual overrides applied last, so they always win over whatever
    # Liquipedia's page currently says -- for real-world changes
    # Liquipedia hasn't been updated to reflect yet. Matched
    # case-insensitively by handle.
    override_by_id = {k.lower(): v for k, v in overrides_for_team.items()}
    for row in players:
        ov = override_by_id.get(row["id"].lower())
        if ov and "playerStatus" in ov:
            row["playerStatus"] = ov["playerStatus"]

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


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--html-dir", required=True, help="Directory of fetched team HTML pages")
    ap.add_argument("--out", default="../public/data/liquipedia_rosters.json")
    args = ap.parse_args()

    matched, unmatched = match_files_to_teams(args.html_dir)
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
    for team, path in matched.items():
        with open(path, encoding="utf-8", errors="replace") as f:
            html = f.read()
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
        print(f"UNMATCHED files ({len(unmatched)}) -- check TEAM_PAGES: {unmatched}")
    missing_teams = set(DEFAULT_TEAMS) - set(matched.keys())
    if missing_teams:
        print(f"Teams with no HTML file provided: {sorted(missing_teams)}")


if __name__ == "__main__":
    main()
