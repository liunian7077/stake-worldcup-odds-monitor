#!/usr/bin/env bash
# 重新安装依赖、重新构建前端、重启后端、reload Nginx
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/stake-worldcup-odds-monitor}"
APP_DIR="$APP_ROOT/app"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
log() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

log "重新安装依赖"
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

log "重新构建前端"
npm run build

log "重启后端服务 (PM2)"
cd "$APP_ROOT"
pm2 reload ecosystem.config.cjs --env production || pm2 start ecosystem.config.cjs --env production
pm2 save

log "reload Nginx"
$SUDO nginx -t
$SUDO systemctl reload nginx

log "完成"
pm2 status
