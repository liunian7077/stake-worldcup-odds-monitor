#!/usr/bin/env bash
# Stake 世界杯赔率监控 —— Ubuntu 22.04 / 24.04 一键部署脚本
# 用法（在仓库根目录、以普通用户运行，脚本内部会按需调用 sudo）：
#   bash deploy.sh
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/stake-worldcup-odds-monitor}"
APP_DIR="$APP_ROOT/app"
DATA_DIR="$APP_ROOT/data"
LOGS_DIR="$APP_ROOT/logs"
BACKUPS_DIR="$APP_ROOT/backups"
SERVICE_NAME="stake-worldcup-odds-backend"
NGINX_SITE="stake-worldcup-odds"

# 脚本所在目录即源代码仓库根目录
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

log "1/12 安装系统依赖 curl git nginx rsync"
$SUDO apt-get update -y
$SUDO apt-get install -y curl git nginx rsync ca-certificates

# 注意：后端使用 Node 内置 node:sqlite，要求 Node ≥ 22.13（22 LTS）。Node 20 没有该模块。
log "2/12 检查并安装 Node.js 22 LTS"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "$CUR_MAJOR" -ge 22 ]; then
    NEED_NODE=0
    log "已安装 Node $(node -v)，跳过"
  fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
  log "已安装 Node $(node -v)"
fi

log "3/12 检查并安装 PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi
log "PM2 版本 $(pm2 -v)"

log "4/12 创建部署目录 $APP_ROOT"
$SUDO mkdir -p "$APP_DIR" "$DATA_DIR" "$LOGS_DIR" "$BACKUPS_DIR"
$SUDO chown -R "$USER":"$USER" "$APP_ROOT"

log "5/12 同步项目代码到 $APP_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "client/dist" \
  --exclude "data" \
  --exclude "logs" \
  --exclude ".env" \
  "$SOURCE_DIR"/ "$APP_DIR"/

log "6/12 复制运维脚本与 PM2 配置到 $APP_ROOT"
cp "$SOURCE_DIR/restart.sh" "$APP_ROOT/restart.sh"
cp "$SOURCE_DIR/backup-db.sh" "$APP_ROOT/backup-db.sh"
cp "$SOURCE_DIR/ecosystem.config.cjs" "$APP_ROOT/ecosystem.config.cjs"
chmod +x "$APP_ROOT/restart.sh" "$APP_ROOT/backup-db.sh"

log "7/12 准备 .env 配置"
if [ ! -f "$APP_ROOT/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_ROOT/.env"
  # 生产默认值
  sed -i "s#^NODE_ENV=.*#NODE_ENV=production#" "$APP_ROOT/.env"
  sed -i "s#^PORT=.*#PORT=3001#" "$APP_ROOT/.env"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$DATA_DIR/odds.sqlite#" "$APP_ROOT/.env"
  sed -i "s#^ENABLE_MOCK_API=.*#ENABLE_MOCK_API=false#" "$APP_ROOT/.env"
  log "已生成 $APP_ROOT/.env —— 部署后请填写 STAKE_ODDS_API_KEY / STAKE_ODDS_API_BASE_URL"
else
  log "已存在 $APP_ROOT/.env，保留不覆盖"
fi
# 让后端（cwd=app）能读到统一的 .env
ln -sfn "$APP_ROOT/.env" "$APP_DIR/.env"

log "8/12 安装依赖并构建前端"
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

log "9/12 自检：运行 smoke 测试"
npm run smoke || { echo "smoke 测试失败，请检查"; exit 1; }

log "10/12 配置 Nginx"
$SUDO cp "$APP_DIR/deploy/nginx.conf" "/etc/nginx/sites-available/$NGINX_SITE"
$SUDO ln -sfn "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/sites-enabled/$NGINX_SITE"
[ -f /etc/nginx/sites-enabled/default ] && $SUDO rm -f /etc/nginx/sites-enabled/default || true
$SUDO nginx -t
$SUDO systemctl reload nginx

log "11/12 启动后端服务（PM2）并设置开机自启"
cd "$APP_ROOT"
pm2 start ecosystem.config.cjs --env production || pm2 reload ecosystem.config.cjs --env production
pm2 save
# 生成并安装开机自启（如已安装会提示已存在，可忽略）
STARTUP_CMD="$(pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 || true)"
if echo "$STARTUP_CMD" | grep -q "sudo"; then
  eval "$STARTUP_CMD" || true
  pm2 save
fi

log "12/12 部署完成"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  访问地址:        http://${IP:-服务器IP}/"
echo "  健康检查:        http://${IP:-服务器IP}/api/health"
echo "  SSE 实时流:      http://${IP:-服务器IP}/events"
echo
pm2 status
echo
echo "如需填写 API Key： 编辑 $APP_ROOT/.env 后执行  bash $APP_ROOT/restart.sh"
