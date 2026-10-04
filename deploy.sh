#!/usr/bin/env bash
# ============================================================
# deploy.sh — Run this script on the Oracle Cloud VM to
# install all dependencies and set up the AI CCTV server.
#
# Usage (on the VM, after git clone):
#   chmod +x deploy.sh && sudo ./deploy.sh
# ============================================================

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-ubuntu}"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  AI CCTV — Oracle Cloud Deployment Setup"
echo "══════════════════════════════════════════════════════"
echo "  App dir   : $APP_DIR"
echo "  Run as    : $SERVICE_USER"
echo ""

# ── 1. System packages ────────────────────────────────────────
echo "▶  Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    python3.11 python3.11-venv python3-pip \
    nginx \
    libgl1 libglib2.0-0 \
    tesseract-ocr libzbar0 \
    nodejs npm \
    git curl unzip

# ── 2. Node version (need v18+) ───────────────────────────────
echo "▶  Ensuring Node 18+..."
node_ver=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$node_ver" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# ── 3. Python venv ────────────────────────────────────────────
echo "▶  Creating Python virtual environment..."
cd "$APP_DIR/backend"
python3.11 -m venv venv
source venv/bin/activate

echo "▶  Installing Python dependencies (this may take a few minutes)..."
pip install --upgrade pip --quiet
# Install CPU-only torch first (smaller, faster)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu --quiet
pip install -r requirements.txt --quiet
deactivate

# ── 4. Build React frontend ───────────────────────────────────
echo "▶  Building React frontend..."
cd "$APP_DIR/frontends/version_5"
npm install --prefer-offline --silent
npm run build
echo "  ✅ Frontend built → frontends/version_5/dist/"

# ── 5. Systemd service ────────────────────────────────────────
echo "▶  Installing systemd service..."
cat > /etc/systemd/system/aicctv.service <<EOF
[Unit]
Description=AI CCTV Management Server
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/backend/venv/bin/python3 $APP_DIR/backend/run.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aicctv
systemctl restart aicctv
echo "  ✅ Service started"

# ── 6. Nginx reverse proxy ────────────────────────────────────
echo "▶  Configuring Nginx..."
# Get public IP for the server_name
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "_")

cat > /etc/nginx/sites-available/aicctv <<EOF
server {
    listen 80;
    server_name $PUBLIC_IP _;

    # Increase timeouts for MJPEG stream
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        # Required for MJPEG streaming (disable buffering)
        proxy_buffering off;
        proxy_cache off;
        proxy_http_version 1.1;
        chunked_transfer_encoding on;
    }
}
EOF

ln -sf /etc/nginx/sites-available/aicctv /etc/nginx/sites-enabled/aicctv
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "  ✅ Nginx configured"

# ── 7. Oracle Cloud OS firewall ───────────────────────────────
echo "▶  Opening port 80 in OS firewall..."
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
# Persist rules
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save
else
    apt-get install -y -qq iptables-persistent
    netfilter-persistent save
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo ""
echo "  App URL : http://$PUBLIC_IP"
echo "  Status  : sudo systemctl status aicctv"
echo "  Logs    : sudo journalctl -u aicctv -f"
echo ""
echo "  ⚠️  Remember to open port 80 in the Oracle Cloud"
echo "     Security List (see deployment guide)."
echo "══════════════════════════════════════════════════════"
