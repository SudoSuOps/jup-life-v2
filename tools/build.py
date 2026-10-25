#!/usr/bin/env python3
"""Render web/templates + web/data into dist/ (static site for Cloudflare Pages).

    python tools/build.py

- Pages are pre-rendered (cards, Today's Batch rows, prices live in the HTML).
- Rasters get WebP (+ AVIF when Pillow supports it) variants at 400/800/1200/1600 and <picture> markup.
- CSS/JS are concatenated, lightly minified and content-hashed.
- Writes sitemap.xml, robots.txt, _headers, _redirects, _routes.json and img/og-hero.jpg.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup
from PIL import Image, ImageDraw, features

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = ROOT / "dist"
WIDTHS = (400, 800, 1200, 1600)
HAS_AVIF = features.check("avif")
FLAVOR_HEX = {"Pumpkin": "#E8731E", "Cinnamon": "#A0522D", "Cranberry": "#9B1B30", "Maple": "#C8862A", "Rhubarb": "#C93A5B",
              "Blueberry": "#3F5BB8", "Peach": "#FFB07C", "Key Lime": "#A8D94A", "Watermelon": "#F2546B", "Coconut": "#F4EFE3",
              "Sea Salt": "#7FD1C2", "Sunflower": "#F6C21C"}
PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"


# ------------------------------------------------------------------ data
def load_json(name: str):
    return json.loads((WEB / "data" / name).read_text())


def load_batch() -> dict:
    """tools/todays-batch/batch.yaml wins when present; else web/data/batch.json."""
    yml = ROOT / "tools" / "todays-batch" / "batch.yaml"
    if yml.exists():
        import yaml

        y = yaml.safe_load(yml.read_text())
        return {
            "date": str(y.get("date") or ""),
            "tray": y.get("season", ""),
            "batch_no": str(y.get("batch_no") or ""),
            "chefs_special": y.get("chefs_special") or "",
            "flavors": [{"name": f["name"], "hex": f["color"], "note": f["note"]} for f in y["flavors"]][:6],
        }
    return load_json("batch.json")


def batch_date_label(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return ""
    return f"{d.strftime('%a').upper()} {d.strftime('%b').upper()} {d.day}"


# ------------------------------------------------------------------ images
MANIFEST: dict[str, dict] = {}


def process_images() -> None:
    src_dir, out_dir = WEB / "img", DIST / "img"
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in sorted(src_dir.iterdir()):
        shutil.copy2(p, out_dir / p.name)
        if p.suffix.lower() != ".webp":
            continue
        with Image.open(p) as im:
            im.load()
            w, h = im.size
            entry = {"w": w, "h": h, "webp": [], "avif": []}
            if "poster" in p.stem or "-800" in p.stem or "-1600" in p.stem:
                MANIFEST[p.name] = entry
                continue
            for tw in WIDTHS:
                if tw >= w:
                    continue
                th = round(h * tw / w)
                small = im.resize((tw, th), Image.LANCZOS)
                small.save(out_dir / f"{p.stem}.w{tw}.webp", "WEBP", quality=80, method=6)
                entry["webp"].append((tw, f"{p.stem}.w{tw}.webp"))
                if HAS_AVIF:
                    small.save(out_dir / f"{p.stem}.w{tw}.avif", "AVIF", quality=55)
                    entry["avif"].append((tw, f"{p.stem}.w{tw}.avif"))
            if HAS_AVIF:
                im.save(out_dir / f"{p.stem}.avif", "AVIF", quality=55)
                entry["avif"].append((w, f"{p.stem}.avif"))
            entry["webp"].append((w, p.name))
            MANIFEST[p.name] = entry


def pic(src: str, alt: str = "", sizes: str = "100vw", lazy: bool = True, cls: str = "", style: str = "",
        priority: bool = False) -> Markup:
    name = Path(src).name
    m = MANIFEST.get(name)
    attrs = f'alt="{html.escape(alt, quote=True)}"'
    if cls:
        attrs += f' class="{cls}"'
    if style:
        attrs += f' style="{style}"'
    if priority:
        attrs += ' fetchpriority="high"'
    elif lazy:
        attrs += ' loading="lazy" decoding="async"'
    if not m:
        return Markup(f'<img src="/{src}" {attrs}>')
    attrs = f'width="{m["w"]}" height="{m["h"]}" ' + attrs
    srcset = ", ".join(f"/img/{f} {w}w" for w, f in m["webp"])
    img = f'<img src="/img/{name}" srcset="{srcset}" sizes="{sizes}" {attrs}>' if len(m["webp"]) > 1 else f'<img src="/img/{name}" {attrs}>'
    if not m["avif"]:
        return Markup(img)
    avif = ", ".join(f"/img/{f} {w}w" for w, f in m["avif"])
    return Markup(f'<picture><source type="image/avif" srcset="{avif}" sizes="{sizes}">{img}</picture>')


def make_og(site_url: str) -> None:
    hero = Image.open(WEB / "img" / "hero-dome-1600.webp").convert("RGB")
    w, h = hero.size
    th = round(w * 630 / 1200)
    top = max(0, (h - th) // 2)
    og = hero.crop((0, top, w, top + th)).resize((1200, 630), Image.LANCZOS)
    logo = Image.open(WEB / "img" / "logo.png").convert("RGBA")
    logo.thumbnail((200, 120))
    pad = 18
    chip = Image.new("RGBA", (logo.width + pad * 2, logo.height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(chip).rounded_rectangle((0, 0, chip.width - 1, chip.height - 1), 16, fill=(251, 247, 240, 245))
    chip.alpha_composite(logo, (pad, pad))
    og = og.convert("RGBA")
    og.alpha_composite(chip, (40, 630 - chip.height - 40))
    og.convert("RGB").save(DIST / "img" / "og-hero.jpg", "JPEG", quality=84, optimize=True, progressive=True)


# ------------------------------------------------------------------ css / js
def short_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:10]


def minify_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    return re.sub(r"\s*([{};,>])\s*", r"\1", css).replace(": ", ":").strip()


def build_assets() -> tuple[str, str]:
    css = "".join((WEB / "css" / f).read_text() for f in ("tokens.css", "fonts.css", "site.css"))
    css = minify_css(css).encode()
    cname = f"site.{short_hash(css)}.css"
    (DIST / "css").mkdir(parents=True, exist_ok=True)
    (DIST / "css" / cname).write_bytes(css)
    js = (WEB / "js" / "main.js").read_bytes()
    jname = f"main.{short_hash(js)}.js"
    (DIST / "js").mkdir(parents=True, exist_ok=True)
    (DIST / "js" / jname).write_bytes(js)
    shutil.copytree(WEB / "fonts", DIST / "fonts", dirs_exist_ok=True)
    shutil.copytree(WEB / "video", DIST / "video", dirs_exist_ok=True)
    return f"/css/{cname}", f"/js/{jname}"


# ------------------------------------------------------------------ seo / geo
def _ld(obj: dict) -> str:
    return '<script type="application/ld+json">\n' + json.dumps(obj, indent=2, ensure_ascii=False).replace("</", "<\\/") + "\n</script>\n"


def add_ld(page_html: str, path: str, base: str, crumbs: dict) -> str:
    """Inject WebSite, BreadcrumbList and FAQPage JSON-LD. FAQ is read from the page's own <details>,
    skipping any answer that still holds a [[placeholder]], so the schema always matches visible copy."""
    blocks = []
    if path == "/":
        blocks.append(_ld({"@context": "https://schema.org", "@type": "WebSite", "name": "JUP LIFE by Mrs. Smash", "url": f"{base}/"}))
    if path in crumbs:
        blocks.append(_ld({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{base}/"},
            {"@type": "ListItem", "position": 2, "name": crumbs[path], "item": f"{base}{path}"}]}))
    qa = []
    for q, a in re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", page_html, re.S):
        if "[[" in a or "[[" in q:
            continue
        txt = lambda x: html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x))).strip()
        qa.append({"@type": "Question", "name": txt(q), "acceptedAnswer": {"@type": "Answer", "text": txt(a)}})
    if qa:
        blocks.append(_ld({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": qa}))
    return page_html.replace("</head>", "".join(blocks) + "</head>", 1) if blocks else page_html


AI_BOTS = ("GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot",
           "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot")


def robots_txt(base: str, indexable: bool) -> str:
    if not indexable:
        return "User-agent: *\nDisallow: /\n"
    bots = "".join(f"User-agent: {b}\nAllow: /\nDisallow: /api/\n\n" for b in AI_BOTS)
    return f"User-agent: *\nAllow: /\nDisallow: /api/\n\n{bots}Sitemap: {base}/sitemap.xml\n"


def llms_txt(site: dict, products: list, batch: dict) -> str:
    base = site["site_url"]
    lines = [
        "# JUP LIFE by Mrs. Smash", "",
        "> JUP LIFE Studio is a small 3D-printing studio in Jupiter, Florida that bakes washable TPU coasters and coastal home pieces "
        "in small seasonal batches, sold retail online and wholesale with custom logos to restaurants, bars, boutique hotels, "
        "rentals and event hosts in Palm Beach County and beyond.", "",
        "## Key facts",
        "- Location: Jupiter, FL (serves Jupiter, Tequesta, Juno Beach, Palm Beach Gardens, West Palm Beach and Palm Beach County; ships within the US)",
        "- Material: flexible TPU 95A, washable; TPU pieces are dishwasher safe (normal dishwasher cycle, avoid extended or high-heat modes)",
        "- Shipping: free on all U.S. orders; orders leave the studio within 2-3 business days",
        "- Samples: retail buyers get 1 free sample coaster; wholesale buyers get 6 free sample coasters. A sample print is made for approval before a logo batch is printed",
        "- Wholesale: custom logo coasters and restaurant coasters from 100 pieces. The Half Dozen is the $29 retail box only, and a logo batch ships within 10 days of approval",
        f"- Current tray: {batch.get('tray', '')}",
        "- Contact: hello@juplifestudio.com, call +1-561-532-7120, text 561-581-8015",
        "- X: https://x.com/juplifestudio",
        "- TikTok: https://www.tiktok.com/@juplifestudio", "",
        "## Pages",
        f"- [Home]({base}/): 3D printed coasters, the current tray, quality, FAQ",
        f"- [Shop]({base}/shop): retail products with prices and checkout",
        f"- [Wholesale & Samples]({base}/wholesale): custom logo coasters for Palm Beach County restaurants, bars, hotels, rentals and events",
        f"- [About]({base}/about): Meet Mrs. Smash (Dee), the face of JUP LIFE by Mrs. Smash",
        f"- [Contact]({base}/contact): call +1-561-532-7120",
        f"- [Palm Beach County]({base}/palm-beach-county): 3D printed coasters for Jupiter, Tequesta, Juno Beach, Palm Beach Gardens, West Palm Beach and Palm Beach County",
        f"- [Shipping & Returns]({base}/shipping-returns)",
        f"- [Privacy]({base}/privacy)", "", "## Products"]
    for p in products:
        if p.get("shop"):
            price = f"${p['price']}" if p.get("price") else "ask about this batch"
            lines.append(f"- {p['name']} ({price}): {p['line']}")
    lines += ["", "## Wholesale price tiers (per coaster)"] + [f"- {t['qty']}: {t['price']}" for t in site.get("tiers", [])]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ render
def main() -> int:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    site = load_json("site.json")
    # Staging-safe: SITE_URL (else Cloudflare's CF_PAGES_URL) sets canonicals/OG/sitemap; pages stay noindex unless INDEXABLE=1.
    site["site_url"] = (os.environ.get("SITE_URL") or os.environ.get("CF_PAGES_URL") or site["site_url"]).rstrip("/")
    indexable = os.environ.get("INDEXABLE") == "1"
    products = load_json("products.json")["products"]
    batch = load_batch()
    summer = "summer" in batch["tray"].lower()
    season = "summer" if summer else "fall"

    process_images()
    css_href, js_src = build_assets()
    make_og(site["site_url"])

    for p in products:
        p["combos_now"] = p.get("summer_combos") if summer and p.get("summer_combos") else p.get("combos")

    env = Environment(loader=FileSystemLoader(WEB / "templates"), autoescape=select_autoescape(["html"]),
                      trim_blocks=True, lstrip_blocks=True)

    def ph(key: str, label: str) -> Markup:
        val = site["placeholders"].get(key, "")
        return Markup(html.escape(val)) if val else Markup(f'<span class="ph">[[{html.escape(label)}]]</span>')

    def product_ld(p: dict) -> Markup:
        # Prices come from products.json, which is what the shop cards show. Never add review or aggregateRating.
        ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "description": p["line"], "sku": p["sku"],
              "brand": {"@type": "Brand", "name": "JUP LIFE Studio"}, "category": "Home & Garden",
              "manufacturer": {"@type": "Organization", "name": "JUP LIFE by Mrs. Smash"},
              "offers": {"@type": "Offer", "price": f"{p['price']:.2f}", "priceCurrency": "USD",
                         "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition",
                         "shippingDetails": {"@type": "OfferShippingDetails",
                                             "shippingRate": {"@type": "MonetaryAmount", "value": "0", "currency": "USD"},
                                             "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "US"},
                                             "deliveryTime": {"@type": "ShippingDeliveryTime",
                                                              "handlingTime": {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 3, "unitCode": "DAY"}}},
                         "url": f"{site['site_url']}/shop"}}
        imgs = [p["img"]] + [g["img"] for g in p.get("gallery", [])] if p.get("img") else []
        if imgs:
            ld["image"] = [f"{site['site_url']}/{i}" for i in imgs]
        return Markup(json.dumps(ld, indent=2).replace("</", "<\\/"))

    env.globals.update(pic=pic, product_ld=product_ld, by_sku={p['sku']: p for p in products}, flavor_hex=FLAVOR_HEX, indexable=indexable, ph=ph, site=site, batch=batch, batch_date=batch_date_label(batch["date"]),
                       season=season, products=products, css_href=css_href, js_src=js_src,
                       site_url=site["site_url"], have_ph=lambda k: bool(site["placeholders"].get(k)),
                       batch_json=Markup(json.dumps(batch, indent=2, ensure_ascii=False).replace("</", "<\\/")))

    pages = {
        "index.html": ("home.html", {"path": "/", "nav": "home"}),
        "shop.html": ("shop.html", {"path": "/shop", "nav": "shop"}),
        "wholesale.html": ("wholesale.html", {"path": "/wholesale", "nav": "wholesale"}),
        "about.html": ("about.html", {"path": "/about", "nav": "about"}),
        "contact.html": ("contact.html", {"path": "/contact", "nav": "contact"}),
        "palm-beach-county.html": ("palm_beach_county.html", {"path": "/palm-beach-county", "nav": "palm"}),
        "privacy.html": ("privacy.html", {"path": "/privacy", "nav": ""}),
        "shipping-returns.html": ("shipping_returns.html", {"path": "/shipping-returns", "nav": ""}),
        "404.html": ("not_found.html", {"path": "/404", "nav": ""}),
    }
    crumbs = {
        "/shop": "Shop",
        "/wholesale": "Wholesale & Samples",
        "/about": "Meet Mrs. Smash",
        "/contact": "Contact",
        "/palm-beach-county": "Palm Beach County",
    }
    for out, (tpl, ctx) in pages.items():
        page_html = env.get_template(tpl).render(page=ctx)
        (DIST / out).write_text(add_ld(page_html, ctx["path"], site["site_url"], crumbs))

    today = date.today().isoformat()
    urls = [(f"{site['site_url']}{p}", pr) for p, pr in (
        ("/", "1.0"), ("/shop", "0.9"), ("/wholesale", "0.9"), ("/about", "0.7"),
        ("/contact", "0.6"), ("/palm-beach-county", "0.8"), ("/shipping-returns", "0.3"), ("/privacy", "0.2"))]
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod><priority>{pr}</priority></url>\n" for u, pr in urls) + "</urlset>\n")
    (DIST / "robots.txt").write_text(robots_txt(site["site_url"], indexable))
    (DIST / "llms.txt").write_text(llms_txt(site, products, batch))
    shutil.copytree(WEB / "root", DIST, dirs_exist_ok=True)  # favicon, touch icons, manifest
    shutil.copy(WEB / "_headers", DIST / "_headers")
    shutil.copy(WEB / "_redirects", DIST / "_redirects")
    (DIST / "_routes.json").write_text(json.dumps({"version": 1, "include": ["/api/*"], "exclude": []}))

    left = sorted(f.name for f in DIST.glob("*.html") if "[[" in f.read_text())
    print(f"site_url={site['site_url']} indexable={indexable}")
    print(f"built {len(pages)} pages, {len(MANIFEST)} images (avif={'yes' if HAS_AVIF else 'no'}), season={season}")
    if left:
        print(f"open [[placeholders]] still showing on: {', '.join(left)}")
    blank_batch = []
    for f in DIST.rglob("*"):
        if not f.is_file() or f.suffix.lower() not in {".html", ".js", ".txt", ".xml", ".css", ".json"}:
            continue
        try:
            body = f.read_text(encoding="utf-8")
        except UnicodeError:
            continue
        if "____" in body:
            blank_batch.append(str(f.relative_to(DIST)))
    if blank_batch:
        print("build failed: placeholder ____ still in dist: " + ", ".join(blank_batch))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
