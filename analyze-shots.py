"""
analyze-shots.py — sanity-check the rendered screenshots.

Confirms the page is not blank/broken by measuring:
  - unique colour count (a blank page has almost none)
  - mean luminance (dark theme should be dark, light theme light)
  - brand-hue pixel presence, proving the WebGL particle field and the
    gradient/accent styling actually painted (readPixels on a composited
    canvas returns empty, so we verify from the rasterised image instead)

Sampling notes
--------------
Pixels are read with an integer STRIDE instead of Image.resize(). Resampling
interpolates, which averages 1-2px accent strokes and gradient edges into the
dark background -- on a 9992px-tall full-page capture that erased almost every
brand pixel and produced a false failure.

Full-page captures are also scored per band rather than over one crop: a tall
page is mostly neutral surface by area, so a whole-image ratio says little.
We require that the page's most colourful band clears the bar, and we report
where the accents actually landed.

Run:  python analyze-shots.py
"""

from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow required:  pip install pillow")

SHOTS = Path(__file__).parent / "screenshots"

MIN_COLORS = 500
MIN_BRAND_RATIO = 0.005
BAND_HEIGHT = 900          # score tall pages one viewport at a time


def brandish(px):
    """True for violet/teal/pink brand pixels (the accent palette)."""
    r, g, b = px[:3]
    violet = b > 90 and b > r + 25 and r > g
    teal = g > 90 and g > r + 30 and b > r + 20
    pink = r > 110 and b > 90 and g < r - 25
    return violet or teal or pink


def sample(im, box=None, target=90_000):
    """Stride-sample real pixels (no interpolation) from an optional crop."""
    region = im.crop(box) if box else im
    w, h = region.size
    stride = max(1, int(((w * h) / target) ** 0.5))
    px = region.load()
    return [px[x, y] for y in range(0, h, stride) for x in range(0, w, stride)]


def brand_ratio(pixels):
    if not pixels:
        return 0.0
    return sum(1 for p in pixels if brandish(p)) / len(pixels)


def analyze(name, expect_dark=True):
    path = SHOTS / name
    if not path.exists():
        print(f"  MISSING {name}")
        return False

    im = Image.open(path).convert("RGB")
    w, h = im.size

    overall = sample(im)
    colors = len(set(overall))
    lum = sum(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in overall) / len(overall)

    tall = h > BAND_HEIGHT * 2
    if tall:
        bands = []
        for top in range(0, h, BAND_HEIGHT):
            bottom = min(top + BAND_HEIGHT, h)
            if bottom - top < 100:
                continue
            bands.append((top, brand_ratio(sample(im, (0, top, w, bottom), 40_000))))
        best_top, best = max(bands, key=lambda b: b[1])
        painted = sum(1 for _, r in bands if r >= MIN_BRAND_RATIO)
    else:
        # single viewport: sample below the nav so chrome doesn't dominate
        best = brand_ratio(sample(im, (0, int(h * 0.15), w, h)))
        best_top, painted, bands = 0, None, None

    ok = True
    print(f"\n  {name}  ({w}x{h})")
    print(f"     unique colours : {colors:,}")
    print(f"     mean luminance : {lum:.1f}")
    if tall:
        print(f"     brand pixels   : {best * 100:.1f}% peak (band at y={best_top})")
        print(f"     bands with accents : {painted}/{len(bands)}")
    else:
        print(f"     brand pixels   : {best * 100:.1f}%")

    if colors < MIN_COLORS:
        print("     FAIL looks blank / flat")
        ok = False
    if expect_dark and lum > 120:
        print("     FAIL dark theme is too bright")
        ok = False
    if not expect_dark and lum < 130:
        print("     FAIL light theme is too dark")
        ok = False
    if best < MIN_BRAND_RATIO:
        print("     FAIL no brand-coloured pixels (gradients/WebGL missing?)")
        ok = False

    if ok:
        print("     ok   rendered with colour + brand accents")
    return ok


def main():
    print("Analyzing rendered screenshots")
    results = [
        analyze("desktop-hero.png", expect_dark=True),
        analyze("mobile-hero.png", expect_dark=True),
        analyze("desktop-full.png", expect_dark=True),
        analyze("light-contact.png", expect_dark=False),
    ]
    print()
    if all(results):
        print("All screenshots look correctly rendered.")
        return 0
    print("Some screenshots failed inspection.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
