#!/usr/bin/env python3
"""
Builds public/data/player_month.json -- the "Player of the Month" card on the
Events page (rft.gg's own left-rail panel).

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

AGGREGATION
-----------
Follows the bucket model's one hard rule (CLAUDE.md): sum the raw counts
across every bucket in scope and divide ONCE at the end -- never average
per-bucket averages, which would weight a 12-round map the same as a
30-round one.

WINNER SELECTION IS ROUND-WEIGHTED, NOT A RAW MAX
--------------------------------------------------
The qualification bar (dynamic_rounds_bar below) only controls who's
ELIGIBLE -- once a candidate clears it, a plain
`max(..., key=avg rating)` treats a player who barely cleared the bar
(few rounds, so a noisier average) exactly the same as one who played all
month. That let a hot small sample beat a real sustained performance.
Selection instead uses an IMDB-style weighted rating that shrinks each
candidate's average toward the qualified pool's own round-weighted mean,
by an amount inversely proportional to their own rounds relative to the
bar: `weighted = v/(v+m) * R + m/(v+m) * C`, where R is the player's own
average rating, v is their rounds played, m is the qualification bar
(reused as the shrinkage strength, not just the entry threshold), and C
is the pool's round-weighted mean rating. A player right at the bar is
pulled roughly halfway to the mean; a player with several times the bar's
rounds is barely shrunk at all. The displayed `rating` field is still the
player's own real (unshrunk) average -- only the ranking used to pick the
winner is adjusted, not the number shown for them.

USAGE
-----
  python3 build_player_month.py            # writes public/data/player_month.json
  python3 build_player_month.py --print     # print, write nothing
"""

import argparse
import json
import os
from datetime import datetime, timezone

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("VLR_OUT", os.path.join(_REPO_ROOT, "public", "data"))

# Dynamic qualification bar -- same shape as LeaderCard.jsx's
# `dynamicQualify` (Records.jsx's leader cards, this repo's other
# established "don't let a small sample win on a fluke" mechanism):
# max(floor, min(target, round(fraction * whoever's played the most this
# month))). ROUNDS_QUALIFY_TARGET (20) is the calibrated bar for a month
# that's genuinely underway -- the ceiling this can never exceed, however
# high round counts climb. It only ever loosens BELOW that on a thin
# scope, scaled off the CURRENT LEADER's own rounds rather than the
# field's median.
#
# This used to be median-based (`max(20, 0.5 * median(rounds))`, matching
# the radar chart's own qualification bar in src/lib/radarProfile.js) --
# switched because that shape has no ceiling at all: as a month runs on
# and round counts climb, the bar climbs with no limit, so a legitimately
# strong performance from a player with fewer total matches (e.g.
# eliminated early, or in a region with a lighter schedule) could get
# excluded purely because the bar grew, not because their sample was
# actually too thin. Pegging to the current leader with a fixed ceiling
# avoids that: the bar can shrink on a razor-thin early-month scope, but
# never grows stricter than ROUNDS_QUALIFY_TARGET regardless of how lopsided
# round counts get later in the month. ROUNDS_QUALIFY_FLOOR keeps it from
# collapsing toward zero on literally the first day of a month, when even
# the busiest player so far may have played only a fraction of one map.
ROUNDS_QUALIFY_TARGET = 20
ROUNDS_QUALIFY_FRACTION = 0.5
ROUNDS_QUALIFY_FLOOR = 10


def dynamic_rounds_bar(rounds):
    max_rounds = max(rounds) if rounds else 0
    return max(ROUNDS_QUALIFY_FLOOR, min(ROUNDS_QUALIFY_TARGET, round(max_rounds * ROUNDS_QUALIFY_FRACTION)))


def div(a, b):
    return (a / b) if b else None


def build(data):
    buckets = data.get("buckets") or []
    dated = [b for b in buckets if isinstance(b.get("d"), str)]
    if not dated:
        return None

    month = max(b["d"] for b in dated)[:7]
    scope = [b for b in dated if b["d"].startswith(month)]
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

    rounds = [t["rnd"] for t in totals.values() if t["rnd"] > 0]
    bar = dynamic_rounds_bar(rounds)

    qualified = [
        (name, t) for name, t in totals.items()
        if t["rnd"] >= bar and t["ratR"] > 0
    ]
    if not qualified:
        return None

    # Round-weighted mean rating across the qualified pool (sum-first, same
    # rule as every other bucket aggregate) -- the shrinkage target `C`.
    pool_rat_s = sum(t["ratS"] for _, t in qualified)
    pool_rat_r = sum(t["ratR"] for _, t in qualified)
    pool_mean = pool_rat_s / pool_rat_r

    def weighted_rating(t):
        v = t["ratR"]
        r = t["ratS"] / v
        return (v / (v + bar)) * r + (bar / (v + bar)) * pool_mean

    name, t = max(qualified, key=lambda kv: weighted_rating(kv[1]))
    meta = (data.get("meta") or {}).get(name, {})

    return {
        "_meta": {
            "source": "Derived from player_agents.json",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "qualificationRounds": round(bar),
            "playersConsidered": len(qualified),
            "poolMeanRating": round(pool_mean, 3),
            "selection": "round-weighted (shrunk toward pool mean; see build_player_month.py)",
        },
        "month": month,
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
        raise SystemExit("no qualifying player found -- wrote nothing")

    if args.dry:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return

    dest = os.path.join(args.data_dir, "player_month.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out['player']} ({out['rating']}) for {out['month']} -> {dest}")


if __name__ == "__main__":
    main()
