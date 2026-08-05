"""One-off: recolors the EWC wordmark logo(s) to solid white, keeping the alpha
channel untouched. vlr.gg's own EWC event pages all share the same black-ink-on-
transparent "EWC" logo (confirmed identical across all 9 EWC-related events fetched
by fetch_event_logos.py) -- black reads as invisible against this site's dark theme,
the same problem team logos had before they were switched to darkmode variants (see
CLAUDE.md). There's no separate "darkmode" asset for this one on vlr.gg to swap to,
so this recolors the pixels directly: every pixel's RGB is forced to white, alpha
left exactly as-is, which cleanly turns a flat-black wordmark white without touching
its shape/anti-aliased edges.
"""
import pathlib
from PIL import Image

LOGO_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "event-logos"

for path in sorted(LOGO_DIR.glob("esports-world-cup*.png")):
    im = Image.open(path).convert("RGBA")
    r, g, b, a = im.split()
    white = Image.new("L", im.size, 255)
    out = Image.merge("RGBA", (white, white, white, a))
    out.save(path, optimize=True)
    print(f"whitened {path.name}")

print("done")
