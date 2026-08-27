"""
analyze-photo.py — locate the subject in the source portrait.

Cropping a portrait blind is how you end up with a headless avatar. This
prints a luminance map plus a per-band skin-tone density so the framing in
CSS (object-position) can be chosen from evidence, not guesswork.

Run:  python analyze-photo.py
"""

import colorsys
import sys
from pathlib import Path

from PIL import Image, ImageOps

# The committed original that every derivative in assets/img/ is generated from.
# It used to point at the raw "WhatsApp Image 2026-08-27 at 11.27.35.jpeg" in the
# repo root, which meant the pipeline broke the moment that file was renamed or
# left out of a clone. Keeping the input inside assets/img/source/ makes
# regenerating the portrait reproducible for anyone who checks the repo out.
SRC = Path(__file__).parent / "assets" / "img" / "source" / "samar-original.jpg"
RAMP = " .:-=+*#%@"


def main() -> int:
    if not SRC.exists():
        print(f"source image not found: {SRC}", file=sys.stderr)
        return 1
    im = ImageOps.exif_transpose(Image.open(SRC)).convert("RGB")
    print(f"source: {im.width}x{im.height}\n")

    w, h = 40, 46
    small = im.resize((w, h), Image.LANCZOS)
    px = small.load()
    print("luminance map (dark '.' -> bright '@'):")
    for y in range(h):
        row = ""
        for x in range(w):
            r, g, b = px[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            row += RAMP[min(9, int(lum * 10))]
        print(f"{int(y / h * 100):3d}% |{row}|")

    print("\nskin-tone density per band (finds the face):")
    big = im.resize((120, 160), Image.LANCZOS)
    bp = big.load()
    bands = 16
    best = (0, -1)
    for band in range(bands):
        y0, y1 = band * 10, (band + 1) * 10
        hits = total = 0
        xs = []
        for y in range(y0, y1):
            for x in range(120):
                r, g, b = bp[x, y]
                total += 1
                hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                if 0.01 < hh < 0.10 and 0.18 < ss < 0.68 and vv > 0.28:
                    hits += 1
                    xs.append(x)
        pct = hits * 100 // total
        if pct > best[1]:
            best = (band, pct)
        cx = f"  centre-x ~{sum(xs) // len(xs) * 100 // 120}%" if xs else ""
        lo, hi = int(band / bands * 100), int((band + 1) / bands * 100)
        print(f"  y {lo:3d}-{hi:3d}%  skin {pct:3d}%  {'#' * (pct * 40 // 100)}{cx}")

    lo = int(best[0] / bands * 100)
    hi = int((best[0] + 1) / bands * 100)
    print(f"\ndensest skin band: y {lo}-{hi}%  ({best[1]}%)")
    print("-> use that as the vertical anchor for object-position on square crops.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
