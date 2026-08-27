"""
verify.py — static integrity check for the portfolio.

Checks:
  1. No duplicate element IDs
  2. Every in-page anchor (#foo) resolves to a real ID
  3. Every #id / [data-*] selector used by the JS exists in the HTML
  4. Every CSS class used in HTML has a definition (reports orphans only)
  5. CSS brace balance in the generated stylesheet
  6. Three.js stays OUT of the critical path (lazy import only)
  7. Every local asset referenced actually exists on disk

Run:  python verify.py
"""

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent
HTML = ROOT / "index.html"
CSS = ROOT / "assets" / "css" / "style.css"
JS_FILES = [
    ROOT / "assets" / "js" / "main.js",
    ROOT / "assets" / "js" / "three-lab.js",
]

fails: list[str] = []
warns: list[str] = []


def check_ids(html: str) -> set[str]:
    ids = re.findall(r'\sid="([^"]+)"', html)
    dupes = [i for i, c in Counter(ids).items() if c > 1]
    if dupes:
        fails.append(f"Duplicate IDs: {dupes}")
    else:
        print(f"  ok  {len(ids)} unique element IDs")
    return set(ids)


def check_anchors(html: str, ids: set[str]) -> None:
    anchors = {a for a in re.findall(r'href="#([^"]+)"', html) if a}
    missing = sorted(anchors - ids)
    if missing:
        fails.append(f"Anchors pointing at missing IDs: {missing}")
    else:
        print(f"  ok  all {len(anchors)} in-page anchors resolve")


def check_js_hooks(html: str, ids: set[str]) -> None:
    js = "\n".join(f.read_text(encoding="utf-8") for f in JS_FILES)

    # #id selectors
    js_ids = set(re.findall(r'getElementById\("([^"]+)"\)', js))
    js_ids |= {m for m in re.findall(r'\$\("#([A-Za-z0-9_-]+)"', js)}
    missing = sorted(js_ids - ids)
    if missing:
        fails.append(f"JS targets IDs absent from HTML: {missing}")
    else:
        print(f"  ok  all {len(js_ids)} JS #id hooks exist")

    # data-* attributes
    js_data = set(re.findall(r'\[data-([a-z-]+)[\]=]', js))
    html_data = set(re.findall(r'\sdata-([a-z-]+)[=>\s]', html))
    missing_data = sorted(js_data - html_data)
    if missing_data:
        fails.append(f"JS queries data-attrs absent from HTML: {missing_data}")
    else:
        print(f"  ok  all {len(js_data)} JS data-attr hooks exist")


def check_css(html: str) -> None:
    css = CSS.read_text(encoding="utf-8")

    if css.count("{") != css.count("}"):
        fails.append(f"CSS brace imbalance: {css.count('{')} open vs {css.count('}')} close")
    else:
        print(f"  ok  CSS braces balanced ({css.count('{')} rules)")

    defined = set(re.findall(r'\.([A-Za-z][A-Za-z0-9_-]*)', css))
    used: set[str] = set()
    for attr in re.findall(r'class="([^"]+)"', html):
        used.update(attr.split())

    # Bootstrap / icon utilities live in the CDN files, not ours
    ignore_prefix = (
        "bi-", "col-", "row", "container", "g-", "d-", "align-", "justify-",
        "text-", "mt-", "mb-", "ms-", "me-", "p-", "px-", "py-", "w-", "h-",
        "order-", "offset-", "flex-", "gap-",
    )
    orphans = sorted(
        c for c in used - defined
        if not c.startswith(ignore_prefix) and c not in {"bi", "row", "lead"}
    )
    if orphans:
        warns.append(f"Classes in HTML with no CSS rule (check for typos): {orphans}")
    else:
        print("  ok  every project class in HTML has CSS")


def check_critical_path(html: str) -> None:
    """Three.js must never return to the critical path.

    This is the regression that cost 10.9s to first paint once already: a
    blocking <script src=".../three..."> in the document. Three.js is now
    fetched by a dynamic import() inside assets/js/three-lab.js, so seeing it
    in the HTML at all means the mistake has been reintroduced.
    """
    tags = re.findall(r"<script[^>]*>", html, flags=re.I)

    three_tags = [t for t in tags if re.search(r"three(\.min)?\.js|three@", t, re.I)]
    if three_tags:
        fails.append(
            "Three.js is loaded by a <script> tag again (must be a dynamic "
            f"import in three-lab.js): {three_tags}"
        )
    else:
        print("  ok  Three.js absent from the critical path (lazy import only)")

    # any non-deferred, non-module script is render-blocking
    blocking = [
        t
        for t in tags
        if "src=" in t.lower()
        and " defer" not in t.lower()
        and " async" not in t.lower()
        and 'type="module"' not in t.lower()
    ]
    head = html.split("</head>", 1)[0]
    blocking_in_head = [t for t in blocking if t in head]
    if blocking_in_head:
        fails.append(f"Render-blocking scripts in <head>: {blocking_in_head}")
    else:
        print("  ok  no render-blocking scripts in <head>")

    # the lazy loader must actually be a module (dynamic import needs it)
    if 'type="module" src="assets/js/three-lab.js"' not in html.replace("'", '"'):
        warns.append("three-lab.js should be loaded with type=\"module\"")

    # every above-the-fold <img> should be eager; below-fold should be lazy
    imgs = re.findall(r"<img[^>]*>", html, flags=re.I)
    no_dims = [i for i in imgs if not ("width=" in i and "height=" in i)]
    if no_dims:
        warns.append(f"{len(no_dims)} <img> without width/height (layout shift risk)")
    else:
        print(f"  ok  all {len(imgs)} <img> carry width/height (no layout shift)")

    no_alt = [i for i in imgs if "alt=" not in i]
    if no_alt:
        fails.append(f"{len(no_alt)} <img> without alt text")
    elif imgs:
        print(f"  ok  all {len(imgs)} <img> have alt text")


def check_assets(html: str) -> None:
    """Every local asset referenced by the HTML must exist on disk."""
    refs = set(re.findall(r'(?:src|href)="(assets/[^"]+)"', html))
    for srcset in re.findall(r'srcset="([^"]+)"', html):
        for part in srcset.split(","):
            url = part.strip().split(" ")[0]
            if url.startswith("assets/"):
                refs.add(url)

    missing = sorted(r for r in refs if not (ROOT / r).exists())
    if missing:
        fails.append(f"Referenced assets missing from disk: {missing}")
    else:
        print(f"  ok  all {len(refs)} local asset references exist")


def main() -> int:
    print("Verifying portfolio integrity\n")
    html = HTML.read_text(encoding="utf-8")

    ids = check_ids(html)
    check_anchors(html, ids)
    check_js_hooks(html, ids)
    check_css(html)
    check_critical_path(html)
    check_assets(html)

    print()
    for w in warns:
        print("  WARN", w)
    for f in fails:
        print("  FAIL", f)

    if fails:
        print(f"\n{len(fails)} problem(s) found.")
        return 1
    print("All checks passed." + (f" ({len(warns)} warning(s))" if warns else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
