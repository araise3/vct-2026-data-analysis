"""
Interactive CLI for adding new tracker.gg links to src/lib/trackerLinks.json
yourself, without hand-editing the JSON or asking Claude to do it each time.

    python data_prep/add_tracker_link.py

Two modes, offered in that order:

1. Guided, by team: walks every player this site actually has a profile
   page for -- every key in public/data/player_buckets.json's `meta`, i.e.
   anyone who's played at least one rated map, current roster or not --
   who doesn't already have an entry in trackerLinks.json, grouped under a
   "-- Team Name --" header (meta.team; a player who's since transferred or
   retired still shows under whatever team they last had buckets for, since
   this is just a grouping label for data entry, not the scoped display
   logic PlayerProfile.jsx itself uses). Deliberately NOT sourced from
   public/data/liquipedia_rosters.json's current-roster list -- that one
   only covers currently-active spots on ~74 tracked orgs, so anyone
   retired, transferred, subbing, or simply missing from Liquipedia's own
   data (a real gap: "chubizin" of BESTIA has buckets on this site but
   never had a liquipedia_rosters.json entry at all) would never surface
   for a link. player_buckets.json's own meta is this site's actual
   ground truth for "is this a real tracked player," so it can't miss
   anyone the guided walkthrough should be finding.
2. Freeform: for a handle that isn't in player_buckets.json either (a
   smurf/alt account entry alongside an already-covered main, or someone
   too new to have a rated map yet) -- prompts for a VLR handle
   (case-insensitive, matched against how PlayerProfile.jsx looks it up)
   plus a Riot ID.

Either way, each entry is written as {"puuid": null, "riotId": "..."}, the
same shape resolve_tracker_puuids.py already expects for a not-yet-resolved
account (see its resolve_entry()) -- if HENRIKDEV_API_KEY is set in this
shell, resolves the puuid immediately instead of waiting for that script's
next scheduled CI run. That script itself (and the daily workflow that
runs it) already re-checks every entry in trackerLinks.json unconditionally,
current roster or not -- puuid upkeep was never actually roster-gated, only
this script's own guided-mode *player list* was, which is what this file
fixes.

Adding a handle that already has account(s) on file appends a new one (asks
first, since VLR handles can collide -- e.g. two different players both
going by "heat" -- so it always shows what's already there before
appending) rather than overwriting; existing accounts and their puuids are
never touched.

Coverage stats (X/Y tracked players with a link on file) print once at
startup and again after every single addition, both modes -- a quick
sanity check that an addition actually moved the needle, and a natural
stopping point ("good enough for now").

The file is rewritten after every single entry, not batched at the end, so
an interrupted session (Ctrl+C mid-run) never loses an entry already
confirmed.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from resolve_tracker_puuids import LINKS_PATH, resolve_by_name_tag  # noqa: E402

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAYER_BUCKETS_PATH = os.path.join(_REPO_ROOT, "public", "data", "player_buckets.json")


def load_links():
    with open(LINKS_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_links(links):
    with open(LINKS_PATH, "w", encoding="utf-8") as f:
        json.dump(links, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_all_players():
    """[(team, player_id), ...] for every player this site has a profile
    page for, team name alphabetical (falling back to "(no team)" for the
    rare player with no meta.team) then player id alphabetical within a
    team. Two different real players can share a VLR handle across teams
    (rare, but happens) -- trackerLinks.json has no way to disambiguate
    that (it's keyed on handle alone), so the second one just rides on the
    first's entry. Not solved here; a pre-existing limit of the data
    shape."""
    try:
        with open(PLAYER_BUCKETS_PATH, encoding="utf-8") as f:
            meta = json.load(f)["meta"]
    except (FileNotFoundError, KeyError):
        return []
    out = [(info.get("team") or "(no team)", pid) for pid, info in meta.items()]
    out.sort(key=lambda x: (x[0], x[1].lower()))
    return out


def coverage_stats(links, all_players):
    total = len(all_players)
    covered = sum(1 for _, pid in all_players if links.get(pid.lower()))
    return covered, total


def print_stats(links, all_players):
    if not all_players:
        return
    covered, total = coverage_stats(links, all_players)
    pct = covered / total * 100 if total else 0
    print(f"  Coverage: {covered}/{total} tracked players have a tracker link ({pct:.0f}%)")


def prompt_riot_id(label="  Riot ID (Name#Tag): "):
    while True:
        riot_id = input(label).strip()
        if not riot_id:
            return None
        if "#" not in riot_id:
            print("    Needs a '#Tag' -- e.g. \"Pa1ze#TTV\". Try again.")
            continue
        return riot_id


def make_entry(riot_id, api_key):
    entry = {"puuid": None, "riotId": riot_id}
    if api_key:
        name, _, tag = riot_id.rpartition("#")
        try:
            data = resolve_by_name_tag(name, tag)
            entry["puuid"] = data["puuid"]
            print(f"    Resolved puuid for '{riot_id}'.")
        except Exception as e:
            print(f"    [warn] Couldn't resolve '{riot_id}' right now ({e}) -- saving with puuid: null.")
    return entry


def add_account(links, handle, riot_id, api_key, all_players):
    """Appends riot_id under handle (assumes caller already checked for an
    existing duplicate), saves, and prints the confirmation + stats line."""
    entry = make_entry(riot_id, api_key)
    links.setdefault(handle, []).append(entry)
    save_links(links)
    print(f"    Added '{riot_id}' for '{handle}'.")
    print_stats(links, all_players)
    print()


def guided_by_team(links, all_players, api_key):
    missing = [(team, pid) for team, pid in all_players if not links.get(pid.lower())]
    if not missing:
        print("Every tracked player already has a tracker link on file!\n")
        return False

    print(f"{len(missing)} tracked player(s) missing a tracker link.\n")
    current_team = None
    for team, pid in missing:
        handle = pid.lower()
        # Re-check -- a duplicate handle earlier in this same pass (see
        # load_all_players' docstring) may have just covered this one.
        if links.get(handle):
            continue
        if team != current_team:
            print(f"-- {team} --")
            current_team = team
        riot_id = prompt_riot_id(f"  {pid} -- Riot ID (Name#Tag, blank to skip): ")
        if riot_id is None:
            print("    Skipped.")
            continue
        add_account(links, handle, riot_id, api_key, all_players)
    return True


def freeform(links, all_players, api_key):
    while True:
        handle_raw = input("VLR handle (blank to quit): ").strip()
        if not handle_raw:
            break
        handle = handle_raw.lower()

        existing = links.get(handle, [])
        if existing:
            print(f"  '{handle}' already has {len(existing)} account(s) on file:")
            for acct in existing:
                print(f"    - {acct['riotId']}")
            confirm = input("  Add another account for this handle? [y/N] ").strip().lower()
            if confirm != "y":
                print()
                continue

        riot_id = prompt_riot_id()
        if riot_id is None:
            print("  No Riot ID entered, skipping.\n")
            continue

        if any(acct["riotId"].lower() == riot_id.lower() for acct in existing):
            print(f"  '{riot_id}' is already on file for '{handle}', skipping.\n")
            continue

        add_account(links, handle, riot_id, api_key, all_players)


def main():
    links = load_links()
    all_players = load_all_players()
    api_key = os.environ.get("HENRIKDEV_API_KEY")
    if not api_key:
        print("(HENRIKDEV_API_KEY not set -- new entries will get puuid: null and")
        print(" get resolved by the next scheduled run of resolve_tracker_puuids.py.)")
    print_stats(links, all_players)
    print()

    if all_players:
        answer = input("Walk through missing players, team by team? [Y/n] ").strip().lower()
        if answer != "n":
            guided_by_team(links, all_players, api_key)
            answer = input("Add any other handles (smurfs/alts, not-yet-tracked players)? [y/N] ").strip().lower()
            if answer != "y":
                print("Done.")
                return
            print()
    else:
        print("(Couldn't load public/data/player_buckets.json -- skipping guided mode.)\n")

    freeform(links, all_players, api_key)

    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nStopped.")
