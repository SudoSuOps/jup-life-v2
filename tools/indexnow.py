#!/usr/bin/env python3
"""Submit sitemap URLs to IndexNow.

Reads the public key file at web/root/<key>.txt (the build copies web/root/
to the site root) and POSTs the sitemap URL list to
https://api.indexnow.org/indexnow.

IndexNow fetches https://<host>/<key>.txt and checks that the body matches
the key, so a push to main has to wait until Cloudflare Pages has published
that file. Retries cover that gap.

    python tools/indexnow.py --sitemap dist/sitemap.xml
    python tools/indexnow.py --sitemap dist/sitemap.xml --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://api.indexnow.org/indexnow"
KEY_RE = re.compile(r"[0-9a-f]{32}")
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
# Cloudflare Browser Integrity Check returns 403 error 1010 for the default
# Python-urllib user agent. The key file is public; this only identifies the pinger.
UA = "JupLifeIndexNow/1.0 (+https://juplifestudio.com)"


def find_key() -> str:
    for folder in (ROOT / "web" / "root", ROOT / "dist"):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.txt")):
            stem = path.stem.strip().lower()
            body = path.read_text(encoding="utf-8").strip().lower()
            if KEY_RE.fullmatch(stem) and body == stem:
                return stem
    sys.exit("IndexNow key file not found. Expected web/root/<32-hex>.txt containing the key.")


def sitemap_urls(path: Path) -> list[str]:
    tree = ET.parse(path)
    urls = [loc.text.strip() for loc in tree.findall(".//sm:loc", NS) if loc.text and loc.text.strip()]
    if not urls:
        # Accept a sitemap written without the namespace prefix.
        urls = [loc.text.strip() for loc in tree.iter() if loc.tag.endswith("loc") and loc.text and loc.text.strip()]
    if not urls:
        sys.exit(f"No <loc> URLs in {path}")
    return urls


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url)
    if not m:
        sys.exit(f"Sitemap URL is missing a host: {url}")
    return m.group(1)


def open_request(url: str, *, data: bytes | None = None, headers: dict | None = None, method: str | None = None):
    hdrs = {"User-Agent": UA}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    return urllib.request.urlopen(req, timeout=30 if data else 20)


def wait_for_key(key: str, key_url: str, retries: int, delay: int) -> None:
    for attempt in range(1, retries + 1):
        try:
            with open_request(key_url) as res:
                body = res.read().decode("utf-8", "replace").strip().lower()
            if res.status == 200 and body == key:
                print(f"key live at {key_url}")
                return
            print(f"key mismatch at {key_url} ({attempt}/{retries})")
        except Exception as exc:  # noqa: BLE001 — network errors are the retry case
            print(f"key not live yet ({attempt}/{retries}): {exc}")
        if attempt < retries:
            time.sleep(delay)
    sys.exit(f"IndexNow key was not published at {key_url}")


def ping(payload: dict) -> int:
    data = json.dumps(payload).encode("utf-8")
    try:
        with open_request(
            ENDPOINT,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        ) as res:
            print(f"IndexNow {res.status} for {len(payload['urlList'])} URLs")
            return 0
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        print(f"IndexNow {exc.code}: {detail}", file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Ping IndexNow with sitemap URLs")
    parser.add_argument("--sitemap", type=Path, default=ROOT / "dist" / "sitemap.xml")
    parser.add_argument("--dry-run", action="store_true", help="Print the payload and do not POST")
    parser.add_argument("--retries", type=int, default=12, help="Times to check that the key file is live")
    parser.add_argument("--delay", type=int, default=30, help="Seconds between key-file checks")
    parser.add_argument("--allow-any-host", action="store_true", help="Allow a sitemap host other than juplifestudio.com")
    args = parser.parse_args()

    if not args.sitemap.is_file():
        sys.exit(f"Sitemap not found: {args.sitemap}. Build first: python tools/build.py")

    key = find_key()
    urls = sitemap_urls(args.sitemap)
    hosts = {host_of(u) for u in urls}
    if len(hosts) != 1:
        sys.exit(f"Sitemap hosts differ: {sorted(hosts)}")
    host = hosts.pop()
    if not args.allow_any_host and not host.endswith("juplifestudio.com"):
        sys.exit(f"Refusing to ping IndexNow for host {host}. Pass --allow-any-host to override.")

    payload = {
        "host": host,
        "key": key,
        "keyLocation": f"https://{host}/{key}.txt",
        "urlList": urls,
    }
    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    wait_for_key(key, payload["keyLocation"], args.retries, args.delay)
    return ping(payload)


if __name__ == "__main__":
    sys.exit(main())
