# Filament shelf on the rig (FastAPI + SQLite)

The way we run it: on the always-on Ubuntu 24.04 rig (the 3090 / Mattermost box), reached at
**filament.juplifestudio.com** through the existing Cloudflare Tunnel, with Cloudflare Access login in front.
Data stays on the rig in one SQLite file. Same page (`../public`) and same API as the D1 version.

```
filament/server/
├── app/            FastAPI app: main.py (routes), auth.py (Access JWT + API token), db.py, logic.py, config.py
├── scripts/        backup.py (nightly), order_digest.py (Mattermost post)
├── deploy/         install.sh, update.sh, systemd units, env example, cloudflared ingress snippet
├── tests/          pytest
└── requirements.txt
```

## Install (once)

```bash
sudo git clone https://github.com/SudoSuOps/jup-life-v2.git /opt/jup-life-v2   # skip if already there
sudo bash /opt/jup-life-v2/filament/server/deploy/install.sh
```
It creates a `jupfilament` system user, a venv in `/opt/jup-filament-venv`, the database in
`/var/lib/jup-filament/filament.db` (seeded with all 32 colors), `/etc/jup-filament.env` with a fresh `API_TOKEN`,
and starts `jup-filament.service` on **127.0.0.1:8790** (local only; the tunnel is the way in). Nightly backups go to
`/var/backups/jup-filament` (30 kept).

## Put it on filament.juplifestudio.com

1. **Tunnel.** Zero Trust → Networks → Tunnels → your tunnel → **Public hostname** → Add:
   subdomain `filament`, domain `juplifestudio.com`, service `HTTP` → `localhost:8790`.
   (Tunnel run from a local config file instead? Add the rule in `deploy/cloudflared-ingress.yml` and restart cloudflared.)
2. **Login.** Zero Trust → Access → Applications → Add → Self-hosted: name `JUP Filament`, domain
   `filament.juplifestudio.com`, policy Allow → Emails: hello@juplifestudio.com, dee@juplifestudio.com. One-time PIN login.
3. **Tell the app about Access.** Copy the application's **AUD tag** and your team domain (`<team>.cloudflareaccess.com`)
   into `/etc/jup-filament.env`, then `sudo systemctl restart jup-filament`.

Until step 3 the API answers 401 to everyone except calls with the API token. That's intended.

## Printers and scripts on the rig

They skip the tunnel and call the app directly:
```bash
source <(sudo grep API_TOKEN /etc/jup-filament.env)
B=http://127.0.0.1:8790/api; H="Authorization: Bearer $API_TOKEN"
curl -s -X POST $B/usage -H "$H" -H 'content-type: application/json' -d '{"filament":"sunlu-orange","grams":84,"note":"Pop tray","source":"p1s"}'
curl -s $B/summary -H "$H"
```
Routes are listed in `../README.md`.

## Daily order list in Mattermost (optional)

Mattermost → Integrations → Incoming Webhooks → add one for the channel you want. Put the URL in
`/etc/jup-filament.env` as `MATTERMOST_WEBHOOK_URL`, then:
```bash
sudo systemctl enable --now jup-filament-digest.timer      # posts at 8:43 when something needs ordering
sudo systemctl start jup-filament-digest.service           # send one now to test (set DIGEST_ALWAYS=1 to post even when nothing's low)
```

## Day to day

| Task | Command |
|---|---|
| Update after a push | `sudo bash /opt/jup-life-v2/filament/server/deploy/update.sh` |
| Logs | `journalctl -u jup-filament -f` |
| Backup now | `sudo systemctl start jup-filament-backup` |
| Restore | `sudo systemctl stop jup-filament && sudo cp /var/backups/jup-filament/<file>.db /var/lib/jup-filament/filament.db && sudo chown jupfilament: /var/lib/jup-filament/filament.db && sudo systemctl start jup-filament` |

## Dev

```bash
cd filament/server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
DEV_OPEN=1 FILAMENT_DB=/tmp/f.db .venv/bin/uvicorn app.main:app --reload --port 8790
.venv/bin/pytest -q
```
