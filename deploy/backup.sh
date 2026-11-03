#!/usr/bin/env bash
# Save the whole database to backups/dukabuddy_<date>.sql.gz and delete backups older than 30 days.
# Runs daily from cron (set up by setup-server.sh). Also download a copy regularly:
#   scp root@<server>:/opt/nyamscomm/backups/*.sql.gz .
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
FILE="backups/dukabuddy_$(date +%Y-%m-%d_%H%M).sql.gz"
docker compose exec -T db pg_dump -U dukabuddy --clean --if-exists dukabuddy | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"
find backups -name 'dukabuddy_*.sql.gz' -mtime +30 -delete
echo "$(date '+%F %T') backup saved: $FILE"
