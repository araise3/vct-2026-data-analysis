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

SELECTION IS A WILSON-LOWER-BOUND CONFIDENCE SCORE, WITH NO ELIGIBILITY GATE
------------------------------------------------------------------------------
Every player with any rated rounds in the window is a candidate -- there is
no minimum-rounds cutoff. An earlier version had one (first a fixed floor,
then a dynamic leader-relative one); removed by direct request.

The ranking is the same technique src/lib/playerDuels.js's
aggregateKdByCountry() uses to rank a country's K/D by confidence rather
than raw value: the Wilson score interval LOWER BOUND, computed on the
player's rating rescaled into a [0, 1] "share of RATING_CEILING" proportion
and treating maps played this week as the trial count `n` (maps, not
rounds or kills -- a whole map is one bounded competitive trial, same
volume unit that file's own comment picks for the same reason: it can't be
inflated by one hot round the way a raw stat can).

This replaces an earlier IMDB-style LINEAR shrinkage (`v/(v+m)*R +
m/(v+m)*C`), which playerDuels.js's own comment proves algebraically is
mathematically incapable of the thing this exists to do: for a genuinely
extreme case (1 map at a hot 2.5 rating vs. 10 maps at a modest, steady
1.3), no shrinkage strength flips the order, because a linear blend can
never fully close the gap on the tiny sample's raw excess over the mean.
Confirmed here with the equivalent player-week numbers -- the linear
version this file used to run picked the 1-map fluke every time. Wilson's
lower bound fixes it because it's NONLINEAR: a small `n` blows up the
interval's width term (proportional to 1/n and 1/sqrt(n)) far more
aggressively than a fixed linear blend ever could, so the 1-map score comes
in well below the 10-map score once n=1 is that punishing.

RATING_CEILING=3.0 is the rescale target, chosen comfortably above any
realistic single-map rating (elite maps top out around 2.0-2.5) so `phat`
never gets close enough to 1.0 to hit Wilson's own known edge case there
(the `phat*(1-phat)` variance term collapsing and artificially inflating
confidence near the bounds). SORT_Z=2.0 matches playerDuels.js's own
SORT_Z exactly -- same standard "2-sigma" confidence level, not a separate
tuning knob for this file to drift out of sync with that one.

The displayed `rating` field is still the player's own real, un-rescaled,
un-shrunk average either way -- only the score used to PICK the winner is
adjusted; nothing about what's shown for them changes.

USAGE
-----
  python3 build_player_week.py            # writes public/data/player_week.json
  python3 build_player_week.py --print     # print, write nothing
"""

import argparse
import json
import math
import os
from datetime import datetime, timedelta, timezone

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("VLR_OUT", os.path.join(_REPO_ROOT, "public", "data"))

WINDOW_DAYS = 7

# Wilson-lower-bound selection, matching src/lib/playerDuels.js's
# aggregateKdByCountry() exactly (same SORT_Z, same "maps are the trial
# count" choice) -- see the module docstring for why this replaced an
# earlier linear-shrinkage version and what RATING_CEILING/SORT_Z do.
RATING_CEILING = 3.0
SORT_Z = 2.0


def div(a, b):
    return (a / b) if b else None


def wilson_lower_bound(phat, n, z):
    if not n:
        return None
    denom = 1 + (z * z) / n
    center = phat + (z * z) / (2 * n)
    adj = z * math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)
    return (center - adj) / denom


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
    # same rule as every other bucket aggregate) -- reported in `_meta` only
    # now (no longer a shrinkage target), for the same "what was the bar"
    # context it always gave.
    pool_rat_s = sum(t["ratS"] for _, t in candidates)
    pool_rat_r = sum(t["ratR"] for _, t in candidates)
    pool_mean = pool_rat_s / pool_rat_r

    def selection_score(t):
        r = t["ratS"] / t["ratR"]
        phat = min(max(r / RATING_CEILING, 0.0), 1.0)
        return wilson_lower_bound(phat, t["maps"], SORT_Z)

    name, t = max(candidates, key=lambda kv: selection_score(kv[1]))
    meta = (data.get("meta") or {}).get(name, {})

    return {
        "_meta": {
            "source": "Derived from player_agents.json",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "playersConsidered": len(candidates),
            "poolMeanRating": round(pool_mean, 3),
            "selection": (
                f"Wilson lower-bound confidence score (rating/{RATING_CEILING} as phat, "
                f"maps played as n, z={SORT_Z}; same technique as playerDuels.js's "
                "aggregateKdByCountry; no eligibility gate; see build_player_week.py)"
            ),
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
