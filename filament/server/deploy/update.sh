#!/usr/bin/env bash
# Pull the latest code and restart.  sudo bash /opt/jup-life-v2/filament/server/deploy/update.sh
set -euo pipefail
cd /opt/jup-life-v2 && git pull --ff-only
/opt/jup-filament-venv/bin/pip install -q -r filament/server/requirements.txt
systemctl restart jup-filament
sleep 2 && curl -fsS http://127.0.0.1:8790/api/health && echo "  <- updated"
