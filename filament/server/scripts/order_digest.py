"""Post the 'what to order' list to a Mattermost channel (incoming webhook). Quiet when nothing needs ordering,
unless DIGEST_ALWAYS=1. Reads the database directly, so it needs no token."""
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db as store  # noqa: E402
from app.config import load  # noqa: E402
from app.main import build_summary  # noqa: E402

url = os.environ.get("MATTERMOST_WEBHOOK_URL", "").strip()
if not url:
    sys.exit("MATTERMOST_WEBHOOK_URL is not set")

cfg = load()
conn = store.connect(cfg.db_path)
s = build_summary(conn)
conn.close()

if not s["order"] and os.environ.get("DIGEST_ALWAYS") != "1":
    print("nothing to order")
    sys.exit(0)

lines = ["#### Filament shelf"]
if s["order"]:
    lines.append(f"**{s['colorsToOrder']} colors to order, {s['spoolsToOrder']} spools.**")
    lines.append("| Color | On hand | Order | Maker / product |")
    lines.append("|---|---:|---:|---|")
    for f in s["order"]:
        mk = " · ".join(x for x in (f["maker"], f["brand"]) if x) or "–"
        lines.append(f"| {f['name']} | {f['grams']:,.0f} g | {f['toOrder']} | {mk} |")
else:
    lines.append("Nothing to order today.")
if s["bestDeal"]:
    d = s["bestDeal"]
    lines.append(f"Best live deal: **{d['supplier']}** ${d['price']:.2f}/spool (${d['perKg']:.2f}/kg)" + (f" · ends {d['expires']}" if d["expires"] else "") + (f" · {d['link']}" if d["link"] else ""))
if s["notCounted"]:
    lines.append(f"_Not counted yet: {len(s['notCounted'])} colors._")
lines.append(f"[Open the shelf]({os.environ.get('FILAMENT_PUBLIC_URL', 'https://filament.juplifestudio.com')})")

r = httpx.post(url, json={"text": "\n".join(lines), "username": "Filament shelf"}, timeout=15)
r.raise_for_status()
print("posted")
