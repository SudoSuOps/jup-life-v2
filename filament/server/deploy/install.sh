#!/usr/bin/env bash
# One-time install on the rig (Ubuntu 24.04). Run from anywhere:  sudo bash /opt/jup-life-v2/filament/server/deploy/install.sh
# Re-running is safe: it keeps your database, env file and token.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 1; }

REPO=/opt/jup-life-v2
VENV=/opt/jup-filament-venv
ENVF=/etc/jup-filament.env
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get install -y -qq python3-venv git >/dev/null

if [[ ! -d $REPO/.git ]]; then
  git clone https://github.com/SudoSuOps/jup-life-v2.git "$REPO"
fi

id jupfilament &>/dev/null || useradd --system --home /var/lib/jup-filament --shell /usr/sbin/nologin jupfilament
install -d -o jupfilament -g jupfilament -m 750 /var/lib/jup-filament /var/backups/jup-filament

python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$REPO/filament/server/requirements.txt"

if [[ ! -f $ENVF ]]; then
  install -m 600 "$HERE/jup-filament.env.example" "$ENVF"
  sed -i "s/^API_TOKEN=.*/API_TOKEN=$(openssl rand -hex 32)/" "$ENVF"
  echo "Created $ENVF. Fill in ACCESS_TEAM_DOMAIN and ACCESS_AUD (and MATTERMOST_WEBHOOK_URL if you want the daily post)."
fi

for u in jup-filament.service jup-filament-backup.service jup-filament-backup.timer jup-filament-digest.service jup-filament-digest.timer; do
  install -m 644 "$HERE/$u" /etc/systemd/system/$u
done
systemctl daemon-reload
systemctl enable --now jup-filament.service jup-filament-backup.timer
if grep -q '^MATTERMOST_WEBHOOK_URL=.\+' "$ENVF"; then systemctl enable --now jup-filament-digest.timer; fi

sleep 2
curl -fsS http://127.0.0.1:8790/api/health && echo "  <- jup-filament is up on 127.0.0.1:8790"
