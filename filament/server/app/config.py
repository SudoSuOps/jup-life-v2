"""Settings from the environment (see deploy/jup-filament.env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # filament/


@dataclass(frozen=True)
class Config:
    db_path: Path
    public_dir: Path
    api_token: str
    access_team_domain: str
    access_aud: str
    dev_open: bool


def load() -> Config:
    team = os.environ.get("ACCESS_TEAM_DOMAIN", "").strip()
    team = team.removeprefix("https://").removeprefix("http://").rstrip("/")
    return Config(
        db_path=Path(os.environ.get("FILAMENT_DB", ROOT / "server" / "data" / "filament.db")),
        public_dir=Path(os.environ.get("FILAMENT_PUBLIC", ROOT / "public")),
        api_token=os.environ.get("API_TOKEN", "").strip(),
        access_team_domain=team,
        access_aud=os.environ.get("ACCESS_AUD", "").strip(),
        dev_open=os.environ.get("DEV_OPEN") == "1",
    )
