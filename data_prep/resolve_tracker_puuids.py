"""
Keeps src/lib/trackerLinks.json's tracker.gg links pointing at the right
player even after a Riot ID change (a "Name#Tag" is player-chosen and
mutable; a puuid is Riot's own permanent per-account id).

Each VLR handle maps to a LIST of accounts, not a single one -- a player
can have more than one known tracker.gg-worthy account (their main plus a
smurf/alt used in scrims or off-stream), and the site links to all of them
from that player's profile. The first entry in the list is treated as the
"main" one for display purposes only; this script resolves/refreshes every
entry in every list identically, with no special-casing for position 0.

Two calls to HenrikDev's unofficial Valorant API (docs.henrikdev.xyz),
mirroring Riot's own account-v1 API it wraps:
  - GET /valorant/v2/account/{name}/{tag}   -> resolves a fresh riotId
    (one with puuid still null, e.g. a hand-added link) to its puuid.
  - GET /valorant/v2/by-puuid/account/{puuid} -> the CURRENT name/tag for
    an already-resolved entry. If it differs from what's stored, the
    player renamed and riotId is updated to match.

Requires HENRIKDEV_API_KEY (a free key from HenrikDev's own Discord, see
their docs -- this repo's copy is a GitHub Actions secret, never
committed). Rate limit is 60 req/min on the free tier; REQUEST_DELAY_S
keeps this well under that even though the entry count here is tiny.

An entry that fails to resolve (account renamed to something HenrikDev
hasn't indexed yet, transient error, deleted account) is left exactly as
it was rather than dropped -- a stale tracker.gg link that still mostly
works is better than silently deleting a link the user hand-curated.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINKS_PATH = os.path.join(_REPO_ROOT, "src", "lib", "trackerLinks.json")

API_BASE = "https://api.henrikdev.xyz/valorant/v2"
REQUEST_DELAY_S = 1.1


def _get(path):
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": os.environ["HENRIKDEV_API_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)["data"]


def resolve_by_name_tag(name, tag):
    encoded = f"{urllib.parse.quote(name)}/{urllib.parse.quote(tag)}"
    return _get(f"/account/{encoded}")


def resolve_by_puuid(puuid):
    return _get(f"/by-puuid/account/{puuid}")


def split_riot_id(riot_id):
    # Riot IDs can contain '#' only as the name/tag separator (Riot doesn't
    # allow a literal '#' inside either half), so this is unambiguous --
    # rsplit, not split, in case a future edge case ever nests one anyway.
    name, _, tag = riot_id.rpartition("#")
    return name, tag


def resolve_entry(entry):
    """Refreshes one {puuid, riotId} entry in place. Returns True if changed."""
    if entry.get("puuid"):
        data = resolve_by_puuid(entry["puuid"])
        fresh_riot_id = f"{data['name']}#{data['tag']}"
        if fresh_riot_id != entry["riotId"]:
            print(f"    renamed '{entry['riotId']}' -> '{fresh_riot_id}'")
            entry["riotId"] = fresh_riot_id
            return True
        return False
    else:
        name, tag = split_riot_id(entry["riotId"])
        data = resolve_by_name_tag(name, tag)
        entry["puuid"] = data["puuid"]
        print(f"    resolved puuid for '{entry['riotId']}'")
        return True


def main():
    if "HENRIKDEV_API_KEY" not in os.environ:
        print("[FATAL] HENRIKDEV_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    with open(LINKS_PATH, encoding="utf-8") as f:
        links = json.load(f)

    changed = False
    total_accounts = 0
    for handle, accounts in links.items():
        for i, entry in enumerate(accounts):
            total_accounts += 1
            label = "main" if i == 0 else f"alt {i}"
            try:
                if resolve_entry(entry):
                    changed = True
            except urllib.error.HTTPError as e:
                print(f"  [warn] {handle} ({label}, '{entry['riotId']}'): HTTP {e.code}, leaving as-is", file=sys.stderr)
            except Exception as e:
                print(f"  [warn] {handle} ({label}, '{entry['riotId']}'): {e}, leaving as-is", file=sys.stderr)
            time.sleep(REQUEST_DELAY_S)

    if changed:
        with open(LINKS_PATH, "w", encoding="utf-8") as f:
            json.dump(links, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"trackerLinks.json updated ({len(links)} players, {total_accounts} accounts).")
    else:
        print(f"trackerLinks.json unchanged ({len(links)} players, {total_accounts} accounts, no renames or new puuids).")


if __name__ == "__main__":
    main()
