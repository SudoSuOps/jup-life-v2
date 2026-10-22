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


# ------------------------------------------------------------------ render
def main() -> int:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    site = load_json("site.json")
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
        ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "description": p["line"],
              "brand": {"@type": "Brand", "name": "JUP LIFE"},
              "offers": {"@type": "Offer", "price": f"{p['price']:.2f}", "priceCurrency": "USD",
                         "availability": "https://schema.org/InStock", "url": f"{site['site_url']}/shop"}}
        if p.get("img"):
            ld["image"] = f"{site['site_url']}/{p['img']}"
        return Markup(json.dumps(ld, indent=2).replace("</", "<\\/"))

    env.globals.update(pic=pic, product_ld=product_ld, ph=ph, site=site, batch=batch, batch_date=batch_date_label(batch["date"]),
                       season=season, products=products, css_href=css_href, js_src=js_src,
                       site_url=site["site_url"], have_ph=lambda k: bool(site["placeholders"].get(k)),
                       batch_json=Markup(json.dumps(batch, indent=2, ensure_ascii=False).replace("</", "<\\/")))

    pages = {
        "index.html": ("home.html", {"path": "/", "nav": "home"}),
        "shop.html": ("shop.html", {"path": "/shop", "nav": "shop"}),
        "wholesale.html": ("wholesale.html", {"path": "/wholesale", "nav": "wholesale"}),
        "privacy.html": ("privacy.html", {"path": "/privacy", "nav": ""}),
        "shipping-returns.html": ("shipping_returns.html", {"path": "/shipping-returns", "nav": ""}),
        "404.html": ("not_found.html", {"path": "/404", "nav": ""}),
    }
    for out, (tpl, ctx) in pages.items():
        (DIST / out).write_text(env.get_template(tpl).render(page=ctx))

    urls = [f"{site['site_url']}{p}" for p in ("/", "/shop", "/wholesale")]
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {site['site_url']}/sitemap.xml\n")
    shutil.copy(WEB / "_headers", DIST / "_headers")
    shutil.copy(WEB / "_redirects", DIST / "_redirects")
    (DIST / "_routes.json").write_text(json.dumps({"version": 1, "include": ["/api/*"], "exclude": []}))

    left = sorted(f.name for f in DIST.glob("*.html") if "[[" in f.read_text())
    print(f"built {len(pages)} pages, {len(MANIFEST)} images (avif={'yes' if HAS_AVIF else 'no'}), season={season}")
    if left:
        print(f"open [[placeholders]] still showing on: {', '.join(left)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
