"""Downloads and resizes agent display icons from valorant-api.com into public/agents/,
rewriting src/lib/agentIcons.json to point at the local files instead of hotlinking the
CDN. One-time asset fetch, re-run only when a new agent releases -- same reasoning as
scraper/liquipedia_team_logos_scraper.py's local team-logo cache (see CLAUDE.md).

valorant-api.com's displayicon.png is a 1024x1024 full-resolution asset (~200-300KB
each); every on-site usage renders it at 16-30px, so hotlinking it directly (the
previous behavior) meant every page load fetched ~8MB across 29 icons for something
displayed at postage-stamp size -- the exact same oversized-asset mistake CLAUDE.md
already documents and fixed once for team logos.
"""
import io
import json
import pathlib
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS_JSON = ROOT / "src" / "lib" / "agentIcons.json"
OUT_DIR = ROOT / "public" / "agents"
TARGET_WIDTH = 128  # >4x the largest on-site render size (30px), comfortable retina headroom
RETRIES = 5
TIMEOUT = 45  # this CDN has been observed at ~20-35KB/s from this network, plus occasional stalls
WORKERS = 6  # measured: 3 concurrent connections got ~35KB/s aggregate vs. ~19KB/s for 1 -- the
             # cap is closer to per-connection than a hard aggregate ceiling, so concurrency helps


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


def process_one(key, url):
    raw = fetch(url)
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    ratio = TARGET_WIDTH / im.width
    target_size = (TARGET_WIDTH, round(im.height * ratio))
    im = im.resize(target_size, Image.LANCZOS)

    out_path = OUT_DIR / f"{key}.png"
    im.save(out_path, optimize=True)
    return out_path, target_size


def main():
    data = json.loads(ICONS_JSON.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    pending = {k: e["icon"] for k, e in data.items() if not e["icon"].startswith("/agents/")}
    for k in list(data.keys()):
        if k not in pending:
            print(f"skip {k}: already local")

    # Written after every successful icon (not just at the end) so a run
    # interrupted partway through -- this CDN is slow and occasionally times
    # out mid-download -- can be re-run and pick up only what's still
    # missing, rather than re-fetching everything from scratch.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process_one, k, url): k for k, url in pending.items()}
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                out_path, target_size = fut.result()
            except Exception as e:  # noqa: BLE001
                print(f"FAILED {key}: {e}")
                continue
            data[key]["icon"] = f"/agents/{key}.png"
            print(f"saved {key} -> {out_path} ({out_path.stat().st_size} bytes, {target_size})")
            ICONS_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("done")


if __name__ == "__main__":
    main()
