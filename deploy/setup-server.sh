#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu cloud server (VPS) for NyamsComm. Run as root from the project folder:
#   git clone https://github.com/matiabe/dukabuddy.git /opt/nyamscomm
#   cd /opt/nyamscomm && bash deploy/setup-server.sh shop.example.com
# Leave out the domain to use a free <server-ip>.sslip.io address instead (still HTTPS).
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(id -u)" -eq 0 ] || { echo "Run this as root (or with sudo)."; exit 1; }

echo "==> Installing Docker, git and the firewall"
apt-get update -q
apt-get install -y -q git curl ufw openssl
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "==> Firewall: only SSH and the website (80/443) are open"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS4 https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
  echo "==> No domain given: using $DOMAIN"
fi

if [ ! -f .env ]; then
  echo "==> Creating .env with a random database password"
  cat > .env <<ENV
# NyamsComm cloud server settings. Never commit this file.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DOMAIN=$DOMAIN
DEMO_DATA=0
COMPOSE_FILE=docker-compose.yml:docker-compose.cloud.yml
ENV
  chmod 600 .env
else
  echo "==> .env already exists: keeping it (DOMAIN updated)"
  sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" .env
fi
[ -f backend/.env ] || { cp backend/.env.example backend/.env; chmod 600 backend/.env; }
chmod +x deploy/*.sh

echo "==> Daily database backup at 02:00 (kept 30 days in $(pwd)/backups)"
echo "0 2 * * * root $(pwd)/deploy/backup.sh >> /var/log/nyamscomm-backup.log 2>&1" > /etc/cron.d/nyamscomm-backup

echo "==> Starting the database only (the website starts after your data is restored)"
docker compose up -d db

cat <<MSG

Server is ready. Next:
  1. Point your domain's DNS (an A record) for $DOMAIN to this server's IP (skip for sslip.io).
  2. Bring your shop data over: copy a backup from the shop computer, then run
       bash deploy/restore.sh /root/dukabuddy_<date>.sql
     That also starts the website.
     (Starting with no data instead? Run: docker compose up -d --build
      and IMMEDIATELY open https://$DOMAIN to create the owner account.)
  3. Optional: put SMS/email/AI keys in backend/.env, then: docker compose up -d
MSG
