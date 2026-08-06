#!/usr/bin/env python3
"""
Download the country flags this site actually uses (Flag.jsx) into
public/flags/, so they're served from the same origin as everything else
instead of hotlinked from jsDelivr at runtime.

WHY
---
Flag.jsx used to point straight at
`https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/{code}.svg`. A table
like Players renders a flag per row -- dozens of distinct countries, each
needing its own first-time round trip to a third-party CDN (DNS/TLS
overhead is mitigated by index.html's preconnect hint, but the request
itself still has to complete before the flag paints). That's exactly the
"images/flags not fully loaded a second or two after the rest of the page"
symptom -- same class of problem the team-logo scrape already fixed for
`TeamLogo.jsx` (see CLAUDE.md's "All 54 team logos replaced..." entry),
solved the same way here: fetch once, serve locally forever after.

This is a point-in-time snapshot, not a live fetch, same tradeoff
`liquipedia_rosters.json`/`teamLogos.json` already make -- a future season
introducing a player from a country not currently in the dataset needs this
script re-run, not a runtime fallback. Re-running is cheap and safe: it
only fetches codes it doesn't already have a file for.

USAGE
-----
    python3 scraper/download_flags.py

Reads country codes out of the already-exported public/data/*.json (no DB
access needed) rather than a hardcoded list, so it stays correct as the
roster changes:
  - public/data/player_buckets.json's `meta[*].countryCode`
  - public/data/liquipedia_rosters.json's per-player/coach `flag`

Source: the `flag-icons` package (github.com/lipis/flag-icons, MIT
licensed), same asset jsDelivr was already serving -- just fetched once and
committed instead of hotlinked per page view.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'public', 'data')
OUT_DIR = os.path.join(ROOT, 'public', 'flags')
BASE_URL = 'https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/{code}.svg'
USER_AGENT = 'vct-2026-data-analysis/1.0 (one-time asset fetch; +https://github.com/)'


def collect_codes():
    codes = set()

    pb_path = os.path.join(DATA_DIR, 'player_buckets.json')
    if os.path.exists(pb_path):
        with open(pb_path, encoding='utf-8') as f:
            pb = json.load(f)
        for meta in (pb.get('meta') or {}).values():
            cc = meta.get('countryCode')
            if cc:
                codes.add(cc.lower())

    lr_path = os.path.join(DATA_DIR, 'liquipedia_rosters.json')
    if os.path.exists(lr_path):
        with open(lr_path, encoding='utf-8') as f:
            lr = json.load(f)
        for team in (lr.get('teams') or {}).values():
            for p in team.get('players', []) + team.get('coaches', []):
                flag = p.get('flag')
                if flag:
                    codes.add(flag.lower())

    return sorted(codes)


def main():
    codes = collect_codes()
    if not codes:
        print('No country codes found in public/data -- nothing to do.', file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    fetched, skipped, failed = 0, 0, []

    for code in codes:
        out_path = os.path.join(OUT_DIR, f'{code}.svg')
        if os.path.exists(out_path):
            skipped += 1
            continue

        url = BASE_URL.format(code=code)
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read()
            with open(out_path, 'wb') as f:
                f.write(body)
            fetched += 1
            print(f'  fetched {code}.svg ({len(body)} bytes)')
        except urllib.error.HTTPError as e:
            failed.append((code, e.code))
            print(f'  [warn] {code}: HTTP {e.code}', file=sys.stderr)
        except Exception as e:
            failed.append((code, str(e)))
            print(f'  [warn] {code}: {e}', file=sys.stderr)
        time.sleep(0.1)

    print(f'\nDone. {fetched} fetched, {skipped} already present, {len(failed)} failed.')
    if failed:
        print('Failed codes (no local flag will render for these until fixed):')
        for code, err in failed:
            print(f'  - {code}: {err}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
