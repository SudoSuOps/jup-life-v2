"""JUP LIFE filament shelf: FastAPI + SQLite, served at filament.juplifestudio.com through a Cloudflare Tunnel.

Same routes and JSON as the D1 version, so public/index.html + app.js work unchanged.
Run: uvicorn app.main:app --host 127.0.0.1 --port 8790   (from filament/server)
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import date
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db as store
from . import logic as L
from .auth import require_auth
from .config import load

NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = load()
    conn = store.connect(cfg.db_path)
    store.init(conn)
    app.state.cfg, app.state.db = cfg, conn
    yield
    conn.close()


app = FastAPI(title="JUP LIFE filament", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def err(status: int, msg: str) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status, headers={"cache-control": "no-store"})


@app.exception_handler(HTTPException)
async def _http(_, e: HTTPException):
    return err(e.status_code, str(e.detail))


@app.exception_handler(RequestValidationError)
async def _invalid(_, e: RequestValidationError):
    return err(400, "Send JSON in the shape the API expects.")


@app.middleware("http")
async def no_store(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/api/"):
        resp.headers["cache-control"] = "no-store"
    resp.headers.setdefault("x-robots-tag", "noindex, nofollow")
    return resp


def conn(request: Request):
    return request.app.state.db


def settings(c) -> dict:
    st = {"spoolG": 1000.0, "lowSpools": 1.0, "targetSpools": 3.0}
    for r in c.execute("SELECT k, v FROM settings"):
        st[r["k"]] = r["v"]
    return st


def with_stock(f: dict, st: dict) -> dict:
    return {**f, "stock": L.stock(f, st)}


Auth = Depends(require_auth)
JSONBody = Body(...)


# ---------------------------------------------------------------- health
@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------- filaments
@app.get("/api/filaments")
def list_filaments(who: str = Auth, c=Depends(conn)):
    st = settings(c)
    rows = c.execute("SELECT * FROM filaments ORDER BY sort, name").fetchall()
    return {"settings": st, "filaments": [with_stock(L.row_to_filament(r), st) for r in rows]}


@app.post("/api/filaments", status_code=201)
def add_filament(b: dict[str, Any] = JSONBody, who: str = Auth, c=Depends(conn)):
    name = L.s(b.get("name"), 80).strip()
    if not name:
        raise HTTPException(400, "Give the color a name.")
    fid = (b.get("id") and L.slug(b["id"])) or f"{L.slug(name)}-{uuid.uuid4().hex[:6]}"
    full, part = L.opt_num(b.get("full")), L.opt_num(b.get("partialG"))
    nozzle, bed = L.temp(b.get("nozzle")), L.temp(b.get("bed"))
    if L.INVALID in (full, part):
        raise HTTPException(400, "Spools and grams must be zero or more.")
    if L.INVALID in (nozzle, bed):
        raise HTTPException(400, "Temps look like 210-230 or 215.")
    vals = (fid, name, b.get("hex") if L.HEX.match(b.get("hex") or "") else "", L.s(b.get("usedIn")),
            b.get("group") if b.get("group") in L.GROUPS else "Other",
            b["order"] if isinstance(b.get("order"), int) else 99, 1 if b.get("clear") else 0,
            None if full is None else int(full), part,
            b.get("material") if b.get("material") in L.MATERIALS else "",
            b.get("maker") if b.get("maker") in L.MAKERS else "", L.s(b.get("brand")), nozzle, bed, L.s(b.get("note"), 400))
    try:
        with store.write(c):
            c.execute("INSERT INTO filaments (id,name,hex,used_in,grp,sort,clear,full,partial_g,material,maker,brand,nozzle,bed,note) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", vals)
    except Exception as e:  # sqlite3.IntegrityError
        if "UNIQUE" in str(e):
            raise HTTPException(409, "A color with that id already exists.") from e
        raise
    return L.row_to_filament(c.execute("SELECT * FROM filaments WHERE id=?", (fid,)).fetchone())


def _int_or(v):
    n = L.opt_num(v)
    return n if n in (None, L.INVALID) else int(n)


FIELDS = {
    "name": ("name", lambda v: L.s(v, 80).strip() or L.INVALID),
    "hex": ("hex", lambda v: v if v == "" or L.HEX.match(str(v)) else L.INVALID),
    "usedIn": ("used_in", lambda v: L.s(v)),
    "group": ("grp", lambda v: v if v in L.GROUPS else L.INVALID),
    "order": ("sort", lambda v: v if isinstance(v, int) else L.INVALID),
    "clear": ("clear", lambda v: 1 if v else 0),
    "full": ("full", _int_or),
    "partialG": ("partial_g", L.opt_num),
    "material": ("material", lambda v: v if v in L.MATERIALS else L.INVALID),
    "maker": ("maker", lambda v: v if v in L.MAKERS else L.INVALID),
    "brand": ("brand", lambda v: L.s(v)),
    "nozzle": ("nozzle", L.temp),
    "bed": ("bed", L.temp),
    "note": ("note", lambda v: L.s(v, 400)),
}


def _one(c, fid: str) -> dict:
    r = c.execute("SELECT * FROM filaments WHERE id=?", (fid,)).fetchone()
    if not r:
        raise HTTPException(404, "No color with that id.")
    return L.row_to_filament(r)


@app.get("/api/filaments/{fid}")
def get_filament(fid: str, who: str = Auth, c=Depends(conn)):
    return with_stock(_one(c, fid), settings(c))


@app.patch("/api/filaments/{fid}")
def patch_filament(fid: str, b: dict[str, Any] = JSONBody, who: str = Auth, c=Depends(conn)):
    sets, vals = [], []
    for k, v in b.items():
        if k not in FIELDS:
            continue
        col, fn = FIELDS[k]
        val = fn(v)
        if val is L.INVALID:
            raise HTTPException(400, f'"{k}" has a value I can\'t save.')
        sets.append(f"{col}=?")
        vals.append(val)
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    with store.write(c):
        cur = c.execute(f"UPDATE filaments SET {', '.join(sets)}, updated_at={NOW} WHERE id=?", (*vals, fid))
        if not cur.rowcount:
            raise HTTPException(404, "No color with that id.")
    return with_stock(_one(c, fid), settings(c))


@app.delete("/api/filaments/{fid}")
def delete_filament(fid: str, who: str = Auth, c=Depends(conn)):
    with store.write(c):
        c.execute("DELETE FROM filaments WHERE id=?", (fid,))
    return {"ok": True}


# ---------------------------------------------------------------- deals
@app.get("/api/deals")
def list_deals(who: str = Auth, c=Depends(conn)):
    return {"deals": [L.row_to_deal(r) for r in c.execute("SELECT * FROM deals ORDER BY added_at DESC")]}


@app.post("/api/deals", status_code=201)
def add_deal(b: dict[str, Any] = JSONBody, who: str = Auth, c=Depends(conn)):
    supplier = L.s(b.get("supplier"), 120).strip()
    price = L.opt_num(b.get("price"))
    if not supplier:
        raise HTTPException(400, "Who is the supplier?")
    if price in (None, L.INVALID):
        raise HTTPException(400, "Add the price per spool.")
    size = L.opt_num(b.get("sizeG"))
    size = size if isinstance(size, float) and size > 0 else 1000.0
    min_qty = L.opt_num(b.get("minQty"))
    if min_qty is L.INVALID:
        raise HTTPException(400, "Minimum order must be a number.")
    exp = b.get("expires") if isinstance(b.get("expires"), str) and len(b["expires"]) == 10 else None
    try:
        exp and date.fromisoformat(exp)
    except ValueError:
        exp = None
    link = L.s(b.get("link"), 500) if str(b.get("link") or "").lower().startswith(("http://", "https://")) else ""
    did = str(uuid.uuid4())
    with store.write(c):
        c.execute("INSERT INTO deals (id,supplier,what,material,price,size_g,min_qty,expires,link,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (did, supplier, L.s(b.get("what")), b.get("material") if b.get("material") in L.MATERIALS else "",
                   price, size, None if min_qty is None else int(min_qty), exp, link, L.s(b.get("notes"), 400)))
    return L.row_to_deal(c.execute("SELECT * FROM deals WHERE id=?", (did,)).fetchone())


@app.delete("/api/deals/{did}")
def delete_deal(did: str, who: str = Auth, c=Depends(conn)):
    with store.write(c):
        c.execute("DELETE FROM deals WHERE id=?", (did,))
    return {"ok": True}


# ---------------------------------------------------------------- settings
LIMITS = {"spoolG": (100, 10000), "lowSpools": (0, 100), "targetSpools": (0, 100)}


@app.get("/api/settings")
def get_settings(who: str = Auth, c=Depends(conn)):
    return settings(c)


@app.put("/api/settings")
def put_settings(b: dict[str, Any] = JSONBody, who: str = Auth, c=Depends(conn)):
    upd = {}
    for k, (lo, hi) in LIMITS.items():
        if k not in b:
            continue
        try:
            n = float(b[k])
        except (TypeError, ValueError):
            n = float("nan")
        if not (lo <= n <= hi):
            raise HTTPException(400, f"{k} must be between {lo} and {hi}.")
        upd[k] = n
    if upd:
        with store.write(c):
            c.executemany("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", list(upd.items()))
    return settings(c)


# ---------------------------------------------------------------- usage (prints)
@app.get("/api/usage")
def list_usage(request: Request, who: str = Auth, c=Depends(conn)):
    q = request.query_params
    try:
        limit = min(500, max(1, int(q.get("limit", 50))))
    except ValueError:
        limit = 50
    if q.get("filament"):
        rows = c.execute("SELECT * FROM usage_log WHERE filament_id=? ORDER BY id DESC LIMIT ?", (q["filament"], limit))
    else:
        rows = c.execute("SELECT * FROM usage_log ORDER BY id DESC LIMIT ?", (limit,))
    return {"usage": [{"id": r["id"], "filament": r["filament_id"], "grams": r["grams"], "note": r["note"],
                       "source": r["source"], "at": r["at"]} for r in rows]}


@app.post("/api/usage")
def log_usage(b: dict[str, Any] = JSONBody, who: str = Auth, c=Depends(conn)):
    items = b["items"] if isinstance(b.get("items"), list) else [b]
    if not 1 <= len(items) <= 20:
        raise HTTPException(400, "Send 1 to 20 items.")
    for it in items:
        try:
            g = float(it.get("grams"))
        except (TypeError, ValueError, AttributeError):
            g = -1
        if not isinstance(it, dict) or not it.get("filament") or not (0 < g <= 20000):
            raise HTTPException(400, "Each item needs a filament id and grams between 0 and 20000.")
    st = settings(c)
    source = L.s(b.get("source") or who, 60)
    out = []
    with store.write(c):
        state: dict[str, dict] = {}
        for it in items:
            fid, grams = str(it["filament"]), float(it["grams"])
            cur = state.get(fid)
            if cur is None:
                r = c.execute("SELECT * FROM filaments WHERE id=?", (fid,)).fetchone()
                if not r:
                    raise HTTPException(404, f'No color with id "{fid}".')
                cur = state[fid] = L.row_to_filament(r)
            c.execute("INSERT INTO usage_log (filament_id, grams, note, source) VALUES (?,?,?,?)",
                      (fid, grams, L.s(it.get("note") or b.get("note"), 200), source))
            if cur["full"] is None and cur["partialG"] is None:
                out.append({"filament": fid, "name": cur["name"], "used": grams, "short": None, "full": None, "partialG": None,
                            "stock": L.stock(cur, st), "note": "Not counted yet, so nothing was taken off the shelf. Count it on the page."})
                continue
            d = L.deduct(cur["full"], cur["partialG"], grams, st["spoolG"])
            cur["full"], cur["partialG"] = d["full"], d["partialG"]
            out.append({"filament": fid, "name": cur["name"], "used": grams, "short": d["short"], "full": d["full"],
                        "partialG": d["partialG"], "stock": L.stock(cur, st)})
        for fid, cur in state.items():
            if cur["full"] is None and cur["partialG"] is None:
                continue
            c.execute(f"UPDATE filaments SET full=?, partial_g=?, updated_at={NOW} WHERE id=?", (cur["full"], cur["partialG"], fid))
    return {"ok": True, "results": out}


# ---------------------------------------------------------------- summary (automations)
def build_summary(c) -> dict:
    st = settings(c)
    allf = [with_stock(L.row_to_filament(r), st) for r in c.execute("SELECT * FROM filaments ORDER BY sort, name")]
    order = [{"id": f["id"], "name": f["name"], "group": f["group"], "grams": f["stock"]["grams"], "toOrder": f["stock"]["toOrder"],
              "maker": f["maker"], "brand": f["brand"], "material": f["material"], "nozzle": f["nozzle"], "bed": f["bed"]}
             for f in allf if f["stock"]["status"] == "order"]
    today = date.today().isoformat()
    deals = [dict(r) for r in c.execute("SELECT supplier, what, material, price, size_g, min_qty, expires, link FROM deals")]
    deals = sorted(({**d, "perKg": round(d["price"] / (d["size_g"] / 1000), 2)} for d in deals if not d["expires"] or d["expires"] >= today),
                   key=lambda d: d["perKg"])
    return {"settings": st, "colorsToOrder": len(order), "spoolsToOrder": sum(f["toOrder"] for f in order),
            "notCounted": [f["name"] for f in allf if not f["stock"]["counted"]],
            "onShelfKg": round(sum(f["stock"]["grams"] for f in allf) / 1000, 2), "order": order,
            "bestDeal": deals[0] if deals else None}


@app.get("/api/summary")
def summary(who: str = Auth, c=Depends(conn)):
    return build_summary(c)


# ---------------------------------------------------------------- the page
@app.get("/", include_in_schema=False)
def index(request: Request):
    return FileResponse(request.app.state.cfg.public_dir / "index.html", headers={"cache-control": "no-cache"})


app.mount("/", StaticFiles(directory=str(load().public_dir)), name="static")
