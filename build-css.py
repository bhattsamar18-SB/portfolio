"""
build-css.py — concatenates the modular CSS sources in assets/css/
into the single stylesheet that index.html links (assets/css/style.css).

Usage:
    python build-css.py

Edit the NUMBERED module files, never style.css (it is generated).
"""

from pathlib import Path

CSS_DIR = Path(__file__).parent / "assets" / "css"
OUTPUT = CSS_DIR / "style.css"

BANNER = """/* =====================================================================
   Samar Bhatt — Portfolio · GENERATED FILE — DO NOT EDIT DIRECTLY
   ---------------------------------------------------------------------
   Built from the numbered modules in assets/css/ by build-css.py.
   Edit those, then run:  python build-css.py
   ===================================================================== */

"""


def main() -> int:
    modules = sorted(p for p in CSS_DIR.glob("*.css") if p.name[:2].isdigit())

    if not modules:
        print("No numbered CSS modules found in", CSS_DIR)
        return 1

    parts = [BANNER]
    for module in modules:
        parts.append(f"\n/* ==== source: {module.name} ==== */\n")
        parts.append(module.read_text(encoding="utf-8").rstrip() + "\n")

    css = "".join(parts)
    OUTPUT.write_text(css, encoding="utf-8")

    kb = len(css.encode("utf-8")) / 1024
    print(f"Built {OUTPUT.name} from {len(modules)} modules -> {kb:.1f} KB")
    for module in modules:
        print("  +", module.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
