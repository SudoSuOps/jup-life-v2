"""SQLite store. Same schema and seed as the D1 version (filament/schema.sql, seed.sql)."""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import ROOT

_lock = threading.Lock()  # one writer at a time; SQLite WAL lets reads run alongside


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init(conn: sqlite3.Connection, seed: bool = True) -> None:
    conn.executescript((ROOT / "schema.sql").read_text())
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(filaments)")}
    for col in ("maker", "nozzle", "bed"):  # databases made before maker/temps
        if col not in cols:
            conn.execute(f"ALTER TABLE filaments ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
    if seed and conn.execute("SELECT COUNT(*) FROM filaments").fetchone()[0] == 0:
        conn.executescript((ROOT / "seed.sql").read_text())


@contextmanager
def write(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
