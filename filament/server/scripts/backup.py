"""Nightly SQLite backup (safe while the app is running). Keeps the newest KEEP copies."""
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

src = Path(os.environ.get("FILAMENT_DB", "/var/lib/jup-filament/filament.db"))
dest_dir = Path(os.environ.get("FILAMENT_BACKUP_DIR", "/var/backups/jup-filament"))
keep = int(os.environ.get("FILAMENT_BACKUP_KEEP", "30"))

if not src.exists():
    sys.exit(f"no database at {src}")
dest_dir.mkdir(parents=True, exist_ok=True)
dest = dest_dir / f"filament-{datetime.now():%Y-%m-%d_%H%M}.db"
with sqlite3.connect(src) as s, sqlite3.connect(dest) as d:
    s.backup(d)
for old in sorted(dest_dir.glob("filament-*.db"))[:-keep]:
    old.unlink()
print(f"backed up to {dest}")
