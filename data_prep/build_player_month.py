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

# Same qualification bar the radar chart already uses
# (src/lib/radarProfile.js): half the field's median rounds, floored. Reused
# rather than invented so "qualified" means one thing across the site -- a
# one-map cameo with a freak rating must not win Player of the Month.
MIN_ROUNDS_FLOOR = 20


def median(xs):
    if not xs:
        return 0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


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
    bar = max(MIN_ROUNDS_FLOOR, 0.5 * median(rounds))

    qualified = [
        (name, t) for name, t in totals.items()
        if t["rnd"] >= bar and t["ratR"] > 0
    ]
    if not qualified:
        return None

    name, t = max(qualified, key=lambda kv: div(kv[1]["ratS"], kv[1]["ratR"]) or 0)
    meta = (data.get("meta") or {}).get(name, {})

    return {
        "_meta": {
            "source": "Derived from player_agents.json",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "qualificationRounds": round(bar),
            "playersConsidered": len(qualified),
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
