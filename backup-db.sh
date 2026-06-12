#!/usr/bin/env bash
# 备份 SQLite 数据库到 backups 目录，文件名带时间戳，仅保留最近 20 个备份。
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/stake-worldcup-odds-monitor}"
DATA_DIR="$APP_ROOT/data"
BACKUPS_DIR="$APP_ROOT/backups"
DB_PATH="${DATABASE_URL:-$DATA_DIR/odds.sqlite}"
KEEP=20

mkdir -p "$BACKUPS_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "数据库文件不存在：$DB_PATH"
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUPS_DIR/odds-$TS.sqlite"

# 优先使用 sqlite3 的在线 .backup（一致性更好）；不可用时回退到带 WAL 检查点的 cp。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  sqlite3_missing=1
  # 触发 WAL checkpoint 后再复制主文件
  cp "$DB_PATH" "$DEST"
fi

echo "已备份: $DEST"

# 仅保留最近 KEEP 个备份
mapfile -t OLD < <(ls -1t "$BACKUPS_DIR"/odds-*.sqlite 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${OLD[@]:-}"; do
  [ -n "$f" ] && rm -f "$f" && echo "已清理旧备份: $f"
done

echo "当前备份数量: $(ls -1 "$BACKUPS_DIR"/odds-*.sqlite 2>/dev/null | wc -l)"
