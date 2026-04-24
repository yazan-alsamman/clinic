#!/usr/bin/env bash
# =============================================================================
# One-time VPS setup for Dr. Elias Clinic (Ubuntu 24.04 LTS)
# Run as root: bash setup.sh
#
# Required env var before running:
#   export VPS_BACKEND_ENV_B64="<base64 of backend/.env>"
#   Generate locally: base64 -w0 backend/.env   (Linux)
#                     base64 backend/.env        (macOS)
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/yazan-alsamman/clinic.git"
APP_DIR="/var/www/clinic"

echo "=============================="
echo " Dr. Elias Clinic — VPS Setup"
echo "=============================="

# ── 1. System packages ──────────────────────────────────────────────────────
echo "[1/8] Updating system packages..."
apt-get update -y && apt-get upgrade -y

# ── 2. Node.js 22 ───────────────────────────────────────────────────────────
echo "[2/8] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "  Node: $(node -v)  |  npm: $(npm -v)"

# ── 3. PM2 + Nginx ──────────────────────────────────────────────────────────
echo "[3/8] Installing PM2 and Nginx..."
npm install -g pm2
apt-get install -y nginx

# ── 4. Firewall ─────────────────────────────────────────────────────────────
echo "[4/8] Configuring UFW firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 5. Clone repo ───────────────────────────────────────────────────────────
echo "[5/8] Cloning repository..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ -d ".git" ]; then
  git pull origin main
else
  git clone "$REPO_URL" .
fi

# ── 6. Backend .env ──────────────────────────────────────────────────────────
echo "[6/8] Writing backend .env..."
if [ -n "${VPS_BACKEND_ENV_B64:-}" ]; then
  printf '%s' "$VPS_BACKEND_ENV_B64" | base64 -d > "$APP_DIR/backend/.env"
  echo "  .env written from VPS_BACKEND_ENV_B64."
else
  echo "  WARNING: VPS_BACKEND_ENV_B64 not set — copying .env.example as placeholder."
  echo "  Edit $APP_DIR/backend/.env with real production values before starting!"
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
fi

# ── 7. Install deps + build frontend ────────────────────────────────────────
echo "[7/8] Installing dependencies and building frontend..."

cd "$APP_DIR/backend"
npm ci --omit=dev

cd "$APP_DIR/frontend"
npm ci
VITE_API_BASE_URL= npm run build

# ── 8. Nginx + PM2 ──────────────────────────────────────────────────────────
echo "[8/8] Configuring Nginx and starting PM2..."

# Nginx site
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/clinic
ln -sf /etc/nginx/sites-available/clinic /etc/nginx/sites-enabled/clinic
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

# PM2
cd "$APP_DIR"
pm2 delete clinic-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
# Register PM2 to start on system boot
env PATH="$PATH:/usr/bin" pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo " App URL : http://187.127.76.76"
echo " API     : http://187.127.76.76/api/health"
echo ""
echo " Useful commands:"
echo "   pm2 status              — process status"
echo "   pm2 logs clinic-api     — backend logs"
echo "   pm2 restart clinic-api  — restart backend"
echo "   systemctl status nginx  — nginx status"
echo "============================================"
