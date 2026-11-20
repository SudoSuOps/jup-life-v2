#!/usr/bin/env python3
"""Snapshot competitor sitemap URLs that mention coasters, for the weekly diff.

    python seo/competitors/snapshot.py        # writes seo/competitors/<domain>.txt

Large catalogs are filtered to URLs containing "coaster" so the diff stays readable.
"""
import gzip, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"}
SITES = {
    "icustomlabel.com": ["https://icustomlabel.com/sitemap.xml"],
    "customcoastersnow.com": ["https://www.customcoastersnow.com/sitemap.xml"],
    "customink.com": ["https://www.customink.com/sitemaps/custom.xml"],
    "4imprint.com": ["https://www.4imprint.com/sitemap.xml"],
    "vistaprint.com": ["https://www.vistaprint.com/sitemap.xml"],
}


def fetch(url):
    try:
        raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read()
    except Exception as e:  # noqa: BLE001
        print(f"  skip {url}: {e}", file=sys.stderr)
        return ""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def urls(sitemap, depth=0, budget=[60]):
    body = fetch(sitemap)
    locs = re.findall(r"<loc>\s*(.*?)\s*</loc>", body)
    if "<sitemapindex" in body and depth < 2:
        out = []
        for child in locs:
            if budget[0] <= 0:
                break
            budget[0] -= 1
            out += urls(child, depth + 1, budget)
        return out
    return locs


for domain, maps in SITES.items():
    found = sorted({u for m in maps for u in urls(m, budget=[60]) if "coaster" in u.lower()})
    (HERE / f"{domain}.txt").write_text("\n".join(found) + ("\n" if found else ""))
    print(f"{domain}: {len(found)} coaster URLs")
