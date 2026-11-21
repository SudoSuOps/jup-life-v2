#!/usr/bin/env python3
"""Render web/templates + web/data into dist/ (static site for Cloudflare Pages).

    python tools/build.py

- Pages are pre-rendered (cards, Today's Batch rows, prices live in the HTML).
- Rasters get WebP (+ AVIF when Pillow supports it) variants at 400/800/1200/1600 and <picture> markup.
  A same-stem PNG next to a WebP is the <img> fallback (width, height, lazy-load stay on the img).
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
              "Blueberry": "#3F5BB8", "Peach": "#FFB07C", "Key Lime": "#A8D94A", "Watermelon": "#F2546B", "Coconut": "#F4EEE3",
              "Sea Salt": "#7FD1C2", "Sunflower": "#F6C21C"}
# /custom-coasters/<slug> use-case pages: slug -> breadcrumb name. Templates live in web/templates/use/.
USE_CASES = {"hotels": "Hotels", "weddings": "Weddings", "events": "Events", "airbnb": "Airbnb Hosts"}
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
    webp_srcset = ", ".join(f"/img/{f} {w}w" for w, f in m["webp"])
    png_name = f"{Path(name).stem}.png"
    has_png = name.lower().endswith(".webp") and (DIST / "img" / png_name).is_file()
    if has_png:
        sources = []
        if m["avif"]:
            avif = ", ".join(f"/img/{f} {w}w" for w, f in m["avif"])
            sources.append(f'<source type="image/avif" srcset="{avif}" sizes="{sizes}">')
        if m["webp"]:
            sources.append(f'<source type="image/webp" srcset="{webp_srcset}" sizes="{sizes}">')
        return Markup(f'<picture>{"".join(sources)}<img src="/img/{png_name}" {attrs}></picture>')
    img = f'<img src="/img/{name}" srcset="{webp_srcset}" sizes="{sizes}" {attrs}>' if len(m["webp"]) > 1 else f'<img src="/img/{name}" {attrs}>'
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
# Google's documented CSP hosts for GA4 (with Ads features) + Google Ads conversions
# (https://developers.google.com/tag-platform/security/guides/csp, read 2026-11-20). US site: google.com TLD only.
GTAG_CSP = {
    "script-src": "https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com",
    "img-src": "https://www.googletagmanager.com https://www.googleadservices.com https://*.google-analytics.com "
               "https://*.google.com https://*.g.doubleclick.net https://pagead2.googlesyndication.com",
    "connect-src": "https://www.googletagmanager.com https://www.googleadservices.com https://*.google-analytics.com "
                   "https://*.google.com https://*.g.doubleclick.net https://pagead2.googlesyndication.com https://ad.doubleclick.net",
    "frame-src": "https://www.googletagmanager.com",
}


def add_gtag_csp(headers: str) -> str:
    def widen(m: re.Match) -> str:
        parts = [d.strip() for d in m.group(1).split(";")]
        seen = set()
        for i, d in enumerate(parts):
            name = d.split(" ", 1)[0]
            if name in GTAG_CSP:
                parts[i] = f"{d} {GTAG_CSP[name]}"
                seen.add(name)
        parts += [f"{k} 'self' {v}" for k, v in GTAG_CSP.items() if k not in seen]
        return "Content-Security-Policy: " + "; ".join(parts)
    return re.sub(r"Content-Security-Policy: ([^\n]+)", widen, headers, count=1)


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
        trail = crumbs[path] if isinstance(crumbs[path], list) else [(crumbs[path], path)]
        items = [("Home", "/")] + trail
        blocks.append(_ld({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i, "name": n, "item": f"{base}{p}"} for i, (n, p) in enumerate(items, 1)]}))
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


def llms_txt(site: dict, products: list, batch: dict, catalog: dict, posts: list) -> str:
    base = site["site_url"]
    lines = [
        "# JUP LIFE by Mrs. Smash", "",
        "> JUP LIFE by Mrs. Smash prints coasters in Jupiter, Florida. The shop sells Pop Coasters ($29, six with a case), Flower Coasters ($39, six with a case) and Coastal Coasters ($39, six). "
        "Custom logo coasters are made for restaurants, bars, hotels, weddings, events and vacation rentals, printed in Jupiter and shipped anywhere in the U.S.", "",
        "## Key facts",
        "- Location: Jupiter, FL. Ships anywhere in the U.S.; local to Palm Beach County and South Florida (Boca Raton, Fort Lauderdale, Miami)",
        "- Coasters: flexible, they bend and won't break; washable",
        "- Shipping: always free on U.S. orders, including custom logo batches; shop orders leave the studio within 2-3 business days",
        "- Samples: samples are available by request on the Enterprise page. A sample print is made for approval before a logo batch is printed",
        "- Enterprise: custom logo coasters and restaurant coasters from 200 pieces. A logo batch ships within 10 days of sample approval",
        "- Returns: within 7 days of delivery if you're not 100% happy, no questions asked",
        f"- Current tray: {batch.get('tray', '')}",
        "- Contact: hello@juplifestudio.com, call +1-561-532-7120, text 561-581-8015",
        "- TikTok: https://www.tiktok.com/@juplifestudios",
        "- Instagram: https://www.instagram.com/juplifestudios/",
        "- X: https://x.com/juplifestudios", "",
        "## Pages",
        f"- [Home]({base}/): the coaster printers, Jupiter FL",
        f"- [Shop]({base}/shop): Pop Coasters, Flower Coasters and Coastal Coasters, with checkout on our Shopify store (shop.juplifestudio.com)",
        f"- [Enterprise]({base}/enterprise): custom logo coasters for restaurants and bars, shipped anywhere in the U.S.",
        f"- [About]({base}/about): Meet Mrs. Smash (Dee), the face of JUP LIFE by Mrs. Smash",
        f"- [Contact]({base}/contact): call +1-561-532-7120",
        f"- [Palm Beach County]({base}/palm-beach-county): 3D printed coasters for Jupiter, Tequesta, Juno Beach, Palm Beach Gardens, West Palm Beach and Palm Beach County",
        f"- [South Florida]({base}/south-florida): custom coasters for Miami, Fort Lauderdale, Boca Raton and Delray Beach",
        f"- [Custom coasters]({base}/custom-coasters): custom logo coasters by use",
        f"- [Hotels]({base}/custom-coasters/hotels): custom coasters for hotels and hospitality",
        f"- [Weddings]({base}/custom-coasters/weddings): custom wedding coasters with names, monogram or date",
        f"- [Events]({base}/custom-coasters/events): custom coasters for corporate events and parties",
        f"- [Airbnb hosts]({base}/custom-coasters/airbnb): custom coasters for Airbnb hosts and vacation rentals",
        f"- [Blog]({base}/blog): guides from the studio",
        *(f"- [{p['title']}]({base}/blog/{p['slug']}): {p['description']}" for p in posts),
        f"- [Shipping & Returns]({base}/shipping-returns)",
        f"- [Privacy]({base}/privacy)", "", "## Products"]
    by_sku = {p["sku"]: p for p in products}
    for sku in catalog.get("listed") or []:
        p = by_sku.get(sku)
        if not p:
            continue
        price = f"${p['price']}" if p.get("price") else "ask about this batch"
        lines.append(f"- {p['name']} ({price}): {p['line']}")
    lines += ["", "## Enterprise price tiers (per coaster)"] + [f"- {t['qty']}: {t['price']}" for t in site.get("tiers", [])]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ shopify
def check_shopify(products: list, catalog: dict, shopify: dict) -> list:
    """Every option combination on a listed card must map to a Shopify variant ID."""
    from itertools import product as combos
    by_sku = {p["sku"]: p for p in products}
    problems = []
    for sku in catalog.get("listed") or []:
        card, entry = by_sku.get(sku), (shopify.get("products") or {}).get(sku)
        if not card or not entry:
            problems.append(f"{sku}: missing from products.json or shopify.json")
            continue
        opts = {o["key"]: [c["value"] for c in o["choices"]] for o in card.get("options") or []}
        if list(opts) != entry.get("options", []):
            problems.append(f"{sku}: option order {list(opts)} != shopify.json {entry.get('options')}")
            continue
        for combo in combos(*opts.values()):
            key = "|".join(combo)
            if not str(entry["variants"].get(key, "")).isdigit():
                problems.append(f"{sku}: {key}")
    return problems


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
    catalog = load_json("catalog.json")
    photo_products = load_json("photos.json").get("products") or {}
    shopify = load_json("shopify.json")
    bad = check_shopify(products, catalog, shopify)
    if bad:
        print("build failed: card choices without a Shopify variant in web/data/shopify.json:\n  " + "\n  ".join(bad))
        return 1
    listed = set(catalog.get("listed") or [])
    for p in products:
        p["listed"] = p["sku"] in listed
        card_shot = (photo_products.get(p["sku"]) or {}).get("card") or {}
        if card_shot.get("img"):
            p["img"] = card_shot["img"]
            if card_shot.get("alt"):
                p["alt"] = card_shot["alt"]
            p["render"] = bool(card_shot.get("render"))
            if card_shot.get("caption"):
                p["caption"] = card_shot["caption"]
    photo_book = {sku: photo_products[sku] for sku in catalog.get("listed") or [] if sku in photo_products}
    posts = load_json("posts.json")["posts"]
    for p in posts:
        p["date_label"] = date.fromisoformat(p["date"]).strftime("%B %-d, %Y")
    batch = load_batch()
    summer = "summer" in batch["tray"].lower()
    season = "summer" if summer else "fall"

    process_images()
    css_href, js_src = build_assets()
    tag = site.get("google_tag") or {}
    for k in ("ga4_id", "ads_id", "sample_label", "call_label"):
        tag[k] = os.environ.get(f"GTAG_{k.upper()}") or tag.get(k, "")  # env override is for local testing only
    site["google_tag"] = tag
    for k, pat in (("ga4_id", r"G-[A-Z0-9]+"), ("ads_id", r"AW-\d+")):
        if tag[k] and not re.fullmatch(pat, tag[k]):
            print(f"build failed: google_tag.{k} {tag[k]!r} doesn't look like {pat}")
            return 1
    gtag_src = ""
    if tag["ga4_id"] or tag["ads_id"]:
        js = (WEB / "js" / "gtag.js").read_bytes()
        gtag_src = f"/js/gtag.{short_hash(js)}.js"
        (DIST / gtag_src.lstrip("/")).write_bytes(js)
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
        offers = {"@type": "Offer", "price": f"{p['price']:.2f}", "priceCurrency": "USD",
                  "itemCondition": "https://schema.org/NewCondition",
                  "shippingDetails": {"@type": "OfferShippingDetails",
                                      "shippingRate": {"@type": "MonetaryAmount", "value": "0", "currency": "USD"},
                                      "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "US"},
                                      "deliveryTime": {"@type": "ShippingDeliveryTime",
                                                       "handlingTime": {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 3, "unitCode": "DAY"}}},
                  # Mirrors the visible policy on /shipping-returns: 7 days from delivery, by mail, customer pays postage.
                  "hasMerchantReturnPolicy": {"@type": "MerchantReturnPolicy", "applicableCountry": "US",
                                              "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                                              "merchantReturnDays": 7, "returnMethod": "https://schema.org/ReturnByMail",
                                              "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility"},
                  "url": f"{site['site_url']}/shop"}
        # Checkout is Shopify; listed coasters are made to order and always buyable.
        offers["availability"] = "https://schema.org/InStock"
        ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "description": p["line"], "sku": p["sku"],
              "brand": {"@type": "Brand", "name": "JUP LIFE Studio"}, "category": "Home & Garden",
              "manufacturer": {"@type": "Organization", "name": "JUP LIFE by Mrs. Smash"},
              "offers": offers}
        imgs = [p["img"]] + [g["img"] for g in p.get("gallery", [])] if p.get("img") else []
        if imgs:
            ld["image"] = [f"{site['site_url']}/{i}" for i in imgs]
        return Markup(json.dumps(ld, indent=2).replace("</", "<\\/"))

    env.globals.update(gtag_src=gtag_src, gtag_loader_id=tag["ga4_id"] or tag["ads_id"], gtag_json=Markup(json.dumps({k: tag[k] for k in ("ga4_id", "ads_id", "sample_label", "call_label")}).replace("</", "<\\/")), posts=posts, shopify_store=shopify["store"], shopify_json=Markup(json.dumps({"store": shopify["store"], "products": {k: {"options": v["options"], "variants": v["variants"]} for k, v in shopify["products"].items()}}, ensure_ascii=False).replace("</", "<\\/")), pic=pic, product_ld=product_ld, by_sku={p['sku']: p for p in products}, flavor_hex=FLAVOR_HEX, indexable=indexable, ph=ph, site=site, batch=batch, batch_date=batch_date_label(batch["date"]),
                       season=season, products=products, catalog=catalog, css_href=css_href, js_src=js_src,
                       site_url=site["site_url"], have_ph=lambda k: bool(site["placeholders"].get(k)),
                       batch_json=Markup(json.dumps(batch, indent=2, ensure_ascii=False).replace("</", "<\\/")),
                       photo_book_json=Markup(json.dumps(photo_book, ensure_ascii=False).replace("</", "<\\/")))

    pages = {
        "index.html": ("home.html", {"path": "/", "nav": "home"}),
        "shop.html": ("shop.html", {"path": "/shop", "nav": "shop"}),
        "enterprise.html": ("wholesale.html", {"path": "/enterprise", "nav": "enterprise"}),
        "about.html": ("about.html", {"path": "/about", "nav": "about"}),
        "contact.html": ("contact.html", {"path": "/contact", "nav": "contact"}),
        "palm-beach-county.html": ("palm_beach_county.html", {"path": "/palm-beach-county", "nav": "palm"}),
        "south-florida.html": ("south_florida.html", {"path": "/south-florida", "nav": "palm"}),
        "custom-coasters.html": ("custom_coasters.html", {"path": "/custom-coasters", "nav": "enterprise"}),
        **{f"custom-coasters/{s}.html": (f"use/{s}.html", {"path": f"/custom-coasters/{s}", "nav": "enterprise"}) for s in USE_CASES},
        "blog.html": ("blog_index.html", {"path": "/blog", "nav": "blog"}),
        **{f"blog/{p['slug']}.html": (f"blog/{p['slug']}.html", {"path": f"/blog/{p['slug']}", "nav": "blog"}) for p in posts},
        "privacy.html": ("privacy.html", {"path": "/privacy", "nav": ""}),
        "shipping-returns.html": ("shipping_returns.html", {"path": "/shipping-returns", "nav": ""}),
        "404.html": ("not_found.html", {"path": "/404", "nav": ""}),
    }
    crumbs = {
        "/shop": "Shop",
        "/enterprise": "Enterprise & Samples",
        "/about": "Meet Mrs. Smash",
        "/contact": "Contact",
        "/palm-beach-county": "Palm Beach County",
        "/south-florida": "South Florida",
        "/custom-coasters": "Custom Coasters",
        **{f"/custom-coasters/{s}": [("Custom Coasters", "/custom-coasters"), (name, f"/custom-coasters/{s}")] for s, name in USE_CASES.items()},
        "/blog": "Blog",
        **{f"/blog/{p['slug']}": [("Blog", "/blog"), (p["title"], f"/blog/{p['slug']}")] for p in posts},
    }
    for out, (tpl, ctx) in pages.items():
        post = next((p for p in posts if ctx["path"] == f"/blog/{p['slug']}"), None)
        page_html = env.get_template(tpl).render(page=ctx, post=post)
        (DIST / out).parent.mkdir(parents=True, exist_ok=True)
        (DIST / out).write_text(add_ld(page_html, ctx["path"], site["site_url"], crumbs))

    today = date.today().isoformat()
    urls = [(f"{site['site_url']}{p}", pr) for p, pr in (
        ("/", "1.0"), ("/shop", "0.9"), ("/enterprise", "0.9"), ("/about", "0.7"),
        ("/contact", "0.6"), ("/palm-beach-county", "0.8"), ("/south-florida", "0.8"), ("/custom-coasters", "0.8"),
        *((f"/custom-coasters/{s}", "0.8") for s in USE_CASES), ("/blog", "0.6"),
        *((f"/blog/{p['slug']}", "0.7") for p in posts), ("/shipping-returns", "0.3"), ("/privacy", "0.2"))]
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod><priority>{pr}</priority></url>\n" for u, pr in urls) + "</urlset>\n")
    (DIST / "robots.txt").write_text(robots_txt(site["site_url"], indexable))
    (DIST / "llms.txt").write_text(llms_txt(site, products, batch, catalog, posts))
    shutil.copytree(WEB / "root", DIST, dirs_exist_ok=True)  # favicon, touch icons, manifest
    headers = (WEB / "_headers").read_text()
    if gtag_src:
        headers = add_gtag_csp(headers)
    (DIST / "_headers").write_text(headers)
    shutil.copy(WEB / "_redirects", DIST / "_redirects")
    (DIST / "_routes.json").write_text(json.dumps({"version": 1, "include": ["/api/*", "/google05d7f4db1ec67c25.html"], "exclude": []}))

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
