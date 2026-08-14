#!/usr/bin/env python3
"""
Builds public/data/player_week.json -- the "Player of the Week" card on the
Events page (rft.gg's own left-rail panel; originally a monthly card, moved
to a rolling 7-day window by direct request -- a calendar month is a long
time relative to how often the winner should actually change against a
season with weekly brackets).

READS PUBLISHED JSON, NOT THE SCRAPER DATABASE
-----------------------------------------------
Deliberately derived from `public/data/player_agents.json` rather than added
to export_from_db.py, for three reasons found while building this:

  * No dated per-player stats exist anywhere the frontend can cheaply reach.
    `player_buckets.json` looks like the obvious source but has NO date at
    all -- its `d` field is DEATHS (see CLAUDE.md). `player_agents.json` is
    the only published file carrying a real per-day date (`d`), with deaths
    renamed to `d_` precisely because of that collision.
  * It needs no database. export_from_db.py's DB_PATH defaults point at
    "C:/Users/leona/Desktop/scrape vlr/", which no longer exists (the .db
    files now sit directly on the Desktop), so anything hung off that script
    can only run where those paths are fixed up. This runs anywhere the repo
    is checked out.
  * Deriving from the same file the site already ships guarantees the card
    agrees with every other page. A parallel SQL path could quietly diverge.

The cost is that this must run AFTER export_from_db.py in any pipeline that
regenerates the buckets. It is cheap (one file read) and safe to re-run.

WINDOW
------
The 7 days ending on the LATEST date present in the data, not on today's
wall-clock date -- this file only ever reads a static published export, so
anchoring to "today" could land on a window with zero data (or a stale one)
if the JSON hasn't been regenerated yet today. Same reasoning the old
monthly version anchored its calendar month to `max(dates)[:7]` rather than
the real current month.

AGGREGATION
-----------
Follows the bucket model's one hard rule (CLAUDE.md): sum the raw counts
across every bucket in scope and divide ONCE at the end -- never average
per-bucket averages, which would weight a 12-round map the same as a
30-round one.

SELECTION IS ROUND-WEIGHTED, WITH NO ELIGIBILITY GATE
-------------------------------------------------------
Every player with any rated rounds in the window is a candidate -- there is
no minimum-rounds cutoff. An earlier version had one (first a fixed floor,
then a dynamic leader-relative one); removed by direct request. Instead the
IMDB-style weighted rating below does ALL the work of tempering a small
sample on its own: `weighted = v/(v+m) * R + m/(v+m) * C`, where R is the
player's own average rating, v is their rounds played this week, m is a
FIXED shrinkage strength (SHRINKAGE_ROUNDS, roughly one map's worth of
rounds -- the smallest unit of real signal this game has), and C is the
whole week's round-weighted mean rating. A player with only a handful of
rounds is pulled hard toward the week's mean; a player with several maps'
worth is barely shrunk at all -- continuous, so nobody is excluded outright
the way a hard gate did, but a one-round cameo still can't win on a fluke.
The displayed `rating` field is still the player's own real (unshrunk)
average -- only the ranking used to pick the winner is adjusted.

USAGE
-----
  python3 build_player_week.py            # writes public/data/player_week.json
  python3 build_player_week.py --print     # print, write nothing
"""

import argparse
import json
import os
from datetime import datetime, timedelta, timezone

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("VLR_OUT", os.path.join(_REPO_ROOT, "public", "data"))

WINDOW_DAYS = 7

# Shrinkage strength for the weighted-rating selection below -- roughly one
# map's worth of rounds. No longer doubles as an eligibility gate the way a
# prior version's qualification bar did; see the module docstring.
SHRINKAGE_ROUNDS = 20


def div(a, b):
    return (a / b) if b else None


def build(data):
    buckets = data.get("buckets") or []
    dated = [b for b in buckets if isinstance(b.get("d"), str)]
    if not dated:
        return None

    end = max(b["d"] for b in dated)
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    start = (end_dt - timedelta(days=WINDOW_DAYS - 1)).strftime("%Y-%m-%d")
    scope = [b for b in dated if start <= b["d"] <= end]
    if not scope:
        return None

    totals = {}
    for b in scope:
        t = totals.setdefault(b["p"], {
            "maps": 0, "rnd": 0, "wn": 0, "ratS": 0.0, "ratR": 0,
            "acsS": 0.0, "acsM": 0, "kastS": 0.0, "kastR": 0,
            "adrS": 0.0, "adrR": 0, "hsS": 0.0, "hsR": 0,
            "k": 0, "d_": 0, "a": 0, "fk": 0, "fd": 0,
        })
        for key in t:
            t[key] += b.get(key, 0) or 0

    candidates = [(name, t) for name, t in totals.items() if t["ratR"] > 0]
    if not candidates:
        return None

    # Round-weighted mean rating across every candidate this week (sum-first,
    # same rule as every other bucket aggregate) -- the shrinkage target `C`.
    pool_rat_s = sum(t["ratS"] for _, t in candidates)
    pool_rat_r = sum(t["ratR"] for _, t in candidates)
    pool_mean = pool_rat_s / pool_rat_r

    def weighted_rating(t):
        v = t["ratR"]
        r = t["ratS"] / v
        return (v / (v + SHRINKAGE_ROUNDS)) * r + (SHRINKAGE_ROUNDS / (v + SHRINKAGE_ROUNDS)) * pool_mean

    name, t = max(candidates, key=lambda kv: weighted_rating(kv[1]))
    meta = (data.get("meta") or {}).get(name, {})

    return {
        "_meta": {
            "source": "Derived from player_agents.json",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "playersConsidered": len(candidates),
            "poolMeanRating": round(pool_mean, 3),
            "selection": f"round-weighted (shrunk toward pool mean, m={SHRINKAGE_ROUNDS} rounds, no eligibility gate; see build_player_week.py)",
        },
        "weekStart": start,
        "weekEnd": end,
        "player": name,
        "team": meta.get("team"),
        "countryCode": meta.get("countryCode"),
        "countryName": meta.get("countryName"),
        "rating": round(div(t["ratS"], t["ratR"]), 2),
        "acs": round(div(t["acsS"], t["acsM"]), 0) if t["acsM"] else None,
        "kd": round(div(t["k"], t["d_"]), 2) if t["d_"] else None,
        "kast": round(div(t["kastS"], t["kastR"]), 4) if t["kastR"] else None,
        "adr": round(div(t["adrS"], t["adrR"]), 0) if t["adrR"] else None,
        "hs": round(div(t["hsS"], t["hsR"]), 4) if t["hsR"] else None,
        "maps": t["maps"],
        "rounds": t["rnd"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", dest="dry", action="store_true")
    ap.add_argument("--data-dir", default=DATA_DIR)
    args = ap.parse_args()

    src = os.path.join(args.data_dir, "player_agents.json")
    if not os.path.exists(src):
        raise SystemExit(f"missing {src} -- run export_from_db.py first")
    with open(src, encoding="utf-8") as f:
        data = json.load(f)

    out = build(data)
    if out is None:
        raise SystemExit("no candidate player found -- wrote nothing")

    if args.dry:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return

    dest = os.path.join(args.data_dir, "player_week.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out['player']} ({out['rating']}) for {out['weekStart']}..{out['weekEnd']} -> {dest}")


if __name__ == "__main__":
    main()
