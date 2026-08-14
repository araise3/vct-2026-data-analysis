#!/usr/bin/env python3
"""
Download map thumbnails from valorant-api.com (a public, community-run
mirror of Riot's game data -- no auth, no documented rate limit) into
public/map-icons/, so they're served from the same origin as every other
icon on the site instead of hotlinked at runtime -- same "fetch once, serve
locally forever after" tradeoff download_flags.py already makes for country
flags, for the same reason (a page rendering several maps at once
shouldn't pay a first-time round trip to a third party per icon).

Uses `listViewIcon` specifically, not `displayIcon` (the plain grey top-down
minimap layout, meant for in-game HUD use) -- listViewIcon is a proper
landscape screenshot thumbnail of the map, the same style Riot's own map
picker uses, and reads far better at small chip size than a minimap outline
does.

This is a point-in-time snapshot, not a live fetch, same tradeoff every
other asset scraper in this directory already makes -- a future map added
to the competitive pool needs this script re-run, not a runtime fallback.
Re-running is cheap and safe: it only fetches maps it doesn't already have
a file for.

USAGE
-----
    python3 scraper/download_map_icons.py

Reads the site's own map name list out of public/data/agents.json's
`mapNames` (no DB access needed, and it's the exact set this site's own
pages need icons for) rather than downloading all 26 maps valorant-api.com
returns -- that list includes removed/unreleased/test maps (Skirmish A-E,
Basic Training, The Range, etc.) this site has no data for.
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'public', 'data')
OUT_DIR = os.path.join(ROOT, 'public', 'map-icons')
MAP_MAP_JSON = os.path.join(ROOT, 'src', 'lib', 'mapIcons.json')
API_URL = 'https://valorant-api.com/v1/maps'
USER_AGENT = 'vct-2026-data-analysis/1.0 (one-time asset fetch; +https://github.com/)'


def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def site_map_names():
    path = os.path.join(DATA_DIR, 'agents.json')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return sorted(set(data['mapNames']))


def fetch_api_maps():
    req = urllib.request.Request(API_URL, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
    # Real playable maps only -- valorant-api.com also returns test/removed
    # maps (Skirmish A-E, Basic Training, The Range x2) with no
    # tacticalDescription (a real map always has one, e.g. "A/B Sites").
    return {m['displayName']: m for m in body['data'] if m.get('tacticalDescription')}


def main():
    names = site_map_names()
    api_maps = fetch_api_maps()

    missing = [n for n in names if n not in api_maps]
    if missing:
        print(f'[warn] no valorant-api.com entry for: {missing} -- these will have no icon', file=sys.stderr)

    os.makedirs(OUT_DIR, exist_ok=True)
    icon_map = {}
    fetched, skipped, failed = 0, 0, []

    for name in names:
        m = api_maps.get(name)
        if not m:
            continue
        icon_url = m.get('listViewIcon')
        if not icon_url:
            failed.append((name, 'no listViewIcon in API response'))
            continue

        local_name = f'{slugify(name)}.png'
        out_path = os.path.join(OUT_DIR, local_name)
        icon_map[name] = f'/map-icons/{local_name}'

        if os.path.exists(out_path):
            skipped += 1
            continue

        req = urllib.request.Request(icon_url, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
            with open(out_path, 'wb') as f:
                f.write(body)
            fetched += 1
            print(f'  fetched {name} -> {local_name} ({len(body)} bytes)')
        except urllib.error.HTTPError as e:
            failed.append((name, f'HTTP {e.code}'))
            print(f'  [warn] {name}: HTTP {e.code}', file=sys.stderr)
        except Exception as e:
            failed.append((name, str(e)))
            print(f'  [warn] {name}: {e}', file=sys.stderr)
        time.sleep(0.2)

    with open(MAP_MAP_JSON, 'w', encoding='utf-8') as f:
        json.dump(icon_map, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'\nDone. {fetched} fetched, {skipped} already present, {len(failed)} failed.')
    print(f'Wrote {len(icon_map)} entries to {MAP_MAP_JSON}')
    if failed:
        print('Failed maps (no local icon will render for these until fixed):')
        for name, err in failed:
            print(f'  - {name}: {err}')
    return 1 if missing or failed else 0


if __name__ == '__main__':
    sys.exit(main())
