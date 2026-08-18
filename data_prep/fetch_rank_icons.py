"""Downloads competitive-rank tier icons from valorant-api.com into public/ranks/,
writing src/lib/rankIcons.json with local paths -- same reasoning and pattern as
fetch_agent_icons.py (that script's own docstring covers why local, resized copies
beat hotlinking valorant-api.com's CDN directly).

    python data_prep/fetch_rank_icons.py

Standard library + Pillow only (same deps fetch_agent_icons.py already needs).

Source: GET https://valorant-api.com/v1/competitivetiers -- an array of one entry
per in-game Episode's tier table (tier names/icons have been stable across recent
Episodes, but each Episode is technically its own table, so this always takes the
LAST entry, matching current live data rather than hardcoding a table id that will
eventually roll over). Each entry's `tiers[]` has {tier, tierName, smallIcon}; a
handful of low tier numbers (the old "Unused1/2" slots) carry `smallIcon: null`
and are skipped.

Keyed by tierName lowercased ("radiant", "immortal 1", ...) to match how this
pipeline already normalizes rank names elsewhere -- HenrikDev's own MMR endpoint
returns Title Case ("Radiant", "Immortal 1"), so the frontend lookup lowercases
before indexing (see RankIcon.jsx). "unrated" is added as an explicit alias for
valorant-api's own "unranked" tier 0, since that's the string HenrikDev actually
returns for a placed-but-not-yet-ranked account.
"""
import io
import json
import pathlib
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS_JSON = ROOT / "src" / "lib" / "rankIcons.json"
OUT_DIR = ROOT / "public" / "ranks"
API_URL = "https://valorant-api.com/v1/competitivetiers"
TARGET_WIDTH = 96  # rendered at ~20-40px on site; comfortable retina headroom, same margin fetch_agent_icons.py uses
RETRIES = 5
TIMEOUT = 45
WORKERS = 6


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "vct-2026-data-analysis/1.0"})
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001 -- network flakiness, just retry
            last_err = e
            time.sleep(2)
    raise last_err


def process_one(filename, url):
    raw = fetch(url)
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    ratio = TARGET_WIDTH / im.width
    target_size = (TARGET_WIDTH, round(im.height * ratio))
    im = im.resize(target_size, Image.LANCZOS)

    out_path = OUT_DIR / filename
    im.save(out_path, optimize=True)
    return out_path, target_size


def main():
    print(f"Fetching {API_URL} ...")
    payload = json.loads(fetch(API_URL))
    latest = payload["data"][-1]
    print(f"Using latest tier table: {latest.get('assetObjectName')} ({latest['uuid']})")

    entries = {}
    for t in latest["tiers"]:
        name = (t.get("tierName") or "").strip()
        icon_url = t.get("smallIcon")
        if not name or not icon_url or name.startswith("Unused"):
            continue
        key = name.lower()
        entries[key] = {"displayName": name.title(), "iconUrl": icon_url, "filename": f"{key.replace(' ', '-')}.png"}
    # HenrikDev's MMR endpoint returns "Unrated" for a placed-but-unranked
    # account, not valorant-api's own "UNRANKED" -- alias it to the same icon
    # file rather than re-downloading it under a second name.
    if "unranked" in entries:
        entries["unrated"] = dict(entries["unranked"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = {}

    # One real download per distinct icon file, not per key -- "unrated" and
    # "unranked" would otherwise fetch the same URL twice.
    to_fetch = {e["filename"]: e["iconUrl"] for e in entries.values()}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process_one, filename, url): filename for filename, url in to_fetch.items()}
        for fut in as_completed(futures):
            filename = futures[fut]
            try:
                out_path, target_size = fut.result()
            except Exception as e:  # noqa: BLE001
                print(f"FAILED {filename}: {e}")
                continue
            print(f"saved {filename} -> {out_path} ({out_path.stat().st_size} bytes, {target_size})")

    for key, e in entries.items():
        if (OUT_DIR / e["filename"]).exists():
            data[key] = {"displayName": e["displayName"], "icon": f"/ranks/{e['filename']}"}

    ICONS_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    print(f"done -- {len(data)} tiers written to {ICONS_JSON}")


if __name__ == "__main__":
    main()
