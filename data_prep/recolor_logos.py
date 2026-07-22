#!/usr/bin/env python3
"""
recolor_logos.py

Downloads the 11 team logos that read poorly on a dark background and
replaces their black/dark-gray pixels with white, leaving other colors
(reds, greens, etc.) untouched. Uses HSV thresholding rather than a flat
RGB cutoff, so it catches true blacks and anti-aliased gray edges without
touching dark-but-saturated colors (e.g. a dark red stays red, it doesn't
get keyed).

Run this locally -- Claude's sandbox can't reach owcdn.net or process
image bytes.

Usage:
    pip install pillow requests --break-system-packages
    python3 recolor_logos.py

Saves recolored PNGs to recolored_logos/<team-slug>.png, then zips them
into recolored_logos.zip for upload back to Claude.
"""
import io
import os
import re
import zipfile
import colorsys
import requests
from PIL import Image

TEAMS = {
    "varrel": "https://owcdn.net/img/63a74624cc76a.png",
    "zeta-division": "https://owcdn.net/img/62a411783d94d.png",
    "team-secret": "https://owcdn.net/img/629f13085ead6.png",
    "giantx": "https://owcdn.net/img/657b2f3fcd199.png",
    "envy": "https://owcdn.net/img/5f3ca822464a3.png",
    "karmine-corp": "https://owcdn.net/img/627403a0d9e48.png",
    "mibr": "https://owcdn.net/img/632be7626d6d9.png",
    "fut-esports": "https://owcdn.net/img/632be9976b8fe.png",
    "furia": "https://owcdn.net/img/632be843b7d51.png",
    "team-vitality": "https://owcdn.net/img/6466d79e1ed40.png",
    "paper-rex": "https://owcdn.net/img/62bbeba74d5cb.png",
}

# A pixel is "keyed" (black -> white) if it's dark (low value) AND not
# strongly colored (low saturation) -- this catches true blacks and
# anti-aliased gray edges, while leaving dark saturated colors alone.
VALUE_THRESHOLD = 0.35   # 0-1, HSV "value" (brightness) must be below this
SATURATION_THRESHOLD = 0.25  # 0-1, HSV "saturation" must be below this


def recolor(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue  # fully transparent, leave alone
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if v < VALUE_THRESHOLD and s < SATURATION_THRESHOLD:
                pixels[x, y] = (255, 255, 255, a)
    return img


def main():
    out_dir = "recolored_logos"
    os.makedirs(out_dir, exist_ok=True)

    for slug, url in TEAMS.items():
        print(f"Processing {slug}...", end=" ")
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content))
        recolored = recolor(img)
        path = os.path.join(out_dir, f"{slug}.png")
        recolored.save(path)
        print("done")

    zip_path = "recolored_logos.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for slug in TEAMS:
            zf.write(os.path.join(out_dir, f"{slug}.png"), arcname=f"{slug}.png")

    print(f"\nDone. {len(TEAMS)} logos recolored and zipped to {zip_path}.")
    print("Upload recolored_logos.zip back to Claude.")


if __name__ == "__main__":
    main()
