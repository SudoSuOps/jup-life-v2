"""Shelf rules: shared with the page (public/app.js) and the D1 functions."""
from __future__ import annotations

import math
import re
from typing import Any

GROUPS = ["Stock", "Pop", "Flower", "Coastal", "Other"]
MATERIALS = ["", "TPU", "PLA", "PETG", "Other"]
MAKERS = ["", "SUNLU", "QIDI", "Bambu Lab", "Other"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
TEMP = re.compile(r"^\d{2,3}(-\d{2,3})?$")
INVALID = object()  # sentinel: value can't be saved


def temp(v: Any) -> str | object:
    s = re.sub(r"\s+", "", str(v if v is not None else "")).replace("–", "-").replace("—", "-")
    s = re.sub(r"°?c$", "", s, flags=re.I)
    return s if s == "" or TEMP.match(s) else INVALID


def opt_num(v: Any) -> float | None | object:
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return INVALID
    return n if math.isfinite(n) and n >= 0 else INVALID


def s(v: Any, n: int = 200) -> str:
    return "" if v is None else str(v)[:n]


def slug(v: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(v).lower()))[:60]


def row_to_filament(r) -> dict:
    return {"id": r["id"], "name": r["name"], "hex": r["hex"], "usedIn": r["used_in"], "group": r["grp"],
            "order": r["sort"], "clear": bool(r["clear"]), "full": r["full"], "partialG": r["partial_g"],
            "material": r["material"], "maker": r["maker"], "brand": r["brand"], "nozzle": r["nozzle"],
            "bed": r["bed"], "note": r["note"], "updatedAt": r["updated_at"]}


def row_to_deal(r) -> dict:
    return {"id": r["id"], "supplier": r["supplier"], "what": r["what"], "material": r["material"],
            "price": r["price"], "sizeG": r["size_g"], "minQty": r["min_qty"], "expires": r["expires"],
            "link": r["link"], "notes": r["notes"], "addedAt": r["added_at"]}


def stock(f: dict, st: dict) -> dict:
    full, part = f.get("full"), f.get("partialG")
    if full is None and part is None:
        return {"counted": False, "grams": 0, "status": "count", "toOrder": 0}
    grams = (full or 0) * st["spoolG"] + (part or 0)
    low = grams < st["lowSpools"] * st["spoolG"]
    to_order = max(0, math.ceil((st["targetSpools"] * st["spoolG"] - grams) / st["spoolG"])) if low else 0
    return {"counted": True, "grams": grams, "spools": round(grams / st["spoolG"], 2),
            "status": "order" if low else "ok", "toOrder": to_order}


def deduct(full: int | None, partial: float | None, grams: float, spool_g: float) -> dict:
    """Open spool first, then crack sealed spools."""
    f, p, g = int(full or 0), float(partial or 0), float(grams)
    while g > 0:
        if p >= g:
            p -= g
            g = 0
            break
        g -= p
        p = 0
        if f > 0:
            f -= 1
            p = spool_g
        else:
            break
    return {"full": f, "partialG": round(p, 1), "short": round(g, 1)}
