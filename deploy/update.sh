#!/usr/bin/env bash
# Get the latest code from GitHub and rebuild (data is kept). Takes a backup first.
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/backup.sh
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Updated."
