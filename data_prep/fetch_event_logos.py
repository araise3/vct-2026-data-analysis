"""Downloads and resizes tournament/event logos from vlr.gg into public/event-logos/,
writing src/lib/eventLogos.json keyed by the RAW event name (exactly the string stored
in player_buckets.json / player_agents.json's embedded events table, e.g.
"Vct 2026 Americas Kickoff") -> local file path. Same local-asset pattern as
fetch_agent_icons.py and scraper/liquipedia_team_logos_scraper.py -- fetch once, serve
from this repo's own origin, not a third-party CDN on every page load.

Source: vlr.gg event pages, not Liquipedia. Every vlr.gg page (event, match, team) carries
an <meta property="og:image"> tag for social-link previews -- for an event page this IS the
tournament logo, confirmed identical to the image inside the page's own
.event-header-thumb block on three different event types (EWC 2026, a VCT Kickoff, and
Champions 2026) before writing this script. One request per event, no HTML-structure
guessing needed beyond that one meta tag.

Event ids: public/data/events.json already carries a real vlr.gg event_id for all 30 VCT
events (join by name). EWC has no equivalent exported file, so its ids are hardcoded below
-- confirmed live against vlr.gg's own og:title on each one before trusting them. Three of
our EWC-2025 event names are synthetic (2025's qualifiers didn't get their own vlr.gg event
id -- see the "EWC 2025 event structure" and "EMEA/Americas/Pacific qualifier" notes in
CLAUDE.md): all three map to the SAME real id, 2449, as "Esports World Cup 2025" itself,
since they're the same physical tournament re-labeled client-side for filtering.
"""
import io
import json
import pathlib
import re
import time
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVENTS_JSON = ROOT / "public" / "data" / "events.json"
OUT_JSON = ROOT / "src" / "lib" / "eventLogos.json"
OUT_DIR = ROOT / "public" / "event-logos"
TARGET_WIDTH = 96  # dropdown-row / pill icon size on the site tops out around 20px
RETRIES = 4
TIMEOUT = 30

# name -> real vlr.gg event id, for events not covered by events.json (EWC has no
# equivalent exported file -- see module docstring).
EWC_EVENT_IDS = {
    "Esports World Cup 2026": 2952,
    "Esports World Cup 2026 Americas Qualifier": 2953,
    "Esports World Cup 2026 Emea Qualifier": 2954,
    "Esports World Cup 2026 Pacific Qualifier": 2955,
    "Esports World Cup 2026 China Qualifier": 2956,
    "Esports World Cup 2025": 2449,
    "Esports World Cup 2025 Americas Qualifier": 2449,
    "Esports World Cup 2025 EMEA Qualifier": 2449,
    "Esports World Cup 2025 Pacific X Asian Champions League Qualifier": 2449,
}

OG_IMAGE_RE = re.compile(r'<meta property="og:image" content="([^"]+)"')


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "vct-2026-data-analysis/1.0"})
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2)
    raise last_err


def main():
    events = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
    name_to_id = {e["name"]: e["event_id"] for e in events}
    name_to_id.update(EWC_EVENT_IDS)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    result = json.loads(OUT_JSON.read_text(encoding="utf-8")) if OUT_JSON.exists() else {}

    for name, event_id in name_to_id.items():
        if name in result:
            print(f"skip {name}: already fetched")
            continue

        print(f"fetching {name} (event {event_id})")
        try:
            html = fetch(f"https://www.vlr.gg/event/{event_id}").decode("utf-8", errors="ignore")
            m = OG_IMAGE_RE.search(html)
            if not m:
                print(f"  no og:image found for {name}, skipping")
                continue
            img_url = m.group(1)

            raw = fetch(img_url)
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            ratio = TARGET_WIDTH / im.width
            target_size = (TARGET_WIDTH, round(im.height * ratio)) if im.width > TARGET_WIDTH else im.size
            if target_size != im.size:
                im = im.resize(target_size, Image.LANCZOS)

            slug = slugify(name)
            out_path = OUT_DIR / f"{slug}.png"
            im.save(out_path, optimize=True)
            result[name] = f"/event-logos/{slug}.png"
            print(f"  saved {out_path} ({out_path.stat().st_size} bytes, {im.size})")
        except Exception as e:  # noqa: BLE001
            print(f"  FAILED {name}: {e}")
            continue

        OUT_JSON.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("done")


if __name__ == "__main__":
    main()
