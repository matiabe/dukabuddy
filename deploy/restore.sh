#!/usr/bin/env bash
# Replace the server's database with a backup (.sql or .sql.gz from backup.bat / backup.sh), then start everything.
#   bash deploy/restore.sh /root/dukabuddy_2026-11-03_1800.sql
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Usage: bash deploy/restore.sh <backup.sql or backup.sql.gz>}"
[ -f "$FILE" ] || { echo "File not found: $FILE"; exit 1; }

read -r -p "This REPLACES all data on this server with $FILE. Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop caddy web backend 2>/dev/null || true
docker compose up -d --wait db
echo "==> Restoring $FILE"
if [[ "$FILE" == *.gz ]]; then reader=(gunzip -c "$FILE"); else reader=(cat "$FILE"); fi
# strip Windows line endings and a UTF-8 byte-order mark in case the file was saved on the shop PC
"${reader[@]}" | sed '1s/^\xEF\xBB\xBF//; s/\r$//' |
  docker compose exec -T db psql -q -v ON_ERROR_STOP=1 --single-transaction -U dukabuddy -d dukabuddy >/dev/null
echo "==> Starting NyamsComm"
docker compose up -d --build
echo "Done. Open https://$(grep '^DOMAIN=' .env | cut -d= -f2)"
