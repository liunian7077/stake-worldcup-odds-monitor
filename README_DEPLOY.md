# 部署文档（日本 Ubuntu 服务器）

本服务为**只读**赔率监控面板：拉取 Stake 世界杯赔率，标准化、记录、监控变化并实时推送。
**不包含**任何下注、自动下注、模拟下注、登录 Stake 账号、读取余额、提交投注、资金、钱包、账户 Token 等功能，部署与运维也不应添加此类功能。

- 系统：Ubuntu 22.04 / 24.04
- 运行时：**Node.js 22 LTS**（后端使用内置 `node:sqlite`，需 Node ≥ 22.13；Node 20 不含该模块）
- 前端：React + Vite，构建后由 Nginx 托管
- 后端：Node.js + Fastify，由 PM2 守护并开机自启
- 数据：SQLite，持久化在 `/opt/stake-worldcup-odds-monitor/data`
- 反代：Nginx 将 `/api` 与 `/events`(SSE) 反代到后端 `127.0.0.1:3001`

## 目录结构

```
/opt/stake-worldcup-odds-monitor
├── app/                  # 应用代码（server/ 后端，client/ 前端）
│   ├── server/
│   ├── client/
│   └── .env -> ../.env   # 软链接到统一 .env
├── data/odds.sqlite      # SQLite 数据库
├── logs/                 # PM2 日志
├── backups/              # 数据库备份
├── ecosystem.config.cjs  # PM2 配置
├── restart.sh
├── backup-db.sh
└── .env                  # 统一配置（不入库）
```

> 说明：仓库 `package.json` 为 `"type": "module"`，PM2 配置因此使用 `ecosystem.config.cjs`（CommonJS），以保证 PM2 正确加载。

## 一键部署

把仓库上传/克隆到服务器任意目录，然后在仓库根目录执行：

```bash
bash deploy.sh
```

`deploy.sh` 会自动完成：安装 `curl/git/nginx/rsync` → 安装 Node.js 20 LTS → 安装 PM2 → 创建 `/opt/...` 目录 → 同步代码到 `app/` → 安装后端与前端依赖 → 构建前端 → 生成 `.env` → 运行 smoke 自检 → 配置并 reload Nginx → 用 PM2 启动后端并设置开机自启 → 输出访问地址与服务状态。

可用环境变量覆盖部署根目录：

```bash
APP_ROOT=/srv/odds bash deploy.sh
```

## 配置 .env

部署后编辑统一配置，然后重启：

```bash
nano /opt/stake-worldcup-odds-monitor/.env
bash /opt/stake-worldcup-odds-monitor/restart.sh
```

`.env` 关键项：

```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=/opt/stake-worldcup-odds-monitor/data/odds.sqlite
STAKE_ODDS_API_BASE_URL=        # Stake 赔率数据 API 基础地址
STAKE_ODDS_API_KEY=             # 只放服务器端，绝不进前端
CORS_ORIGIN=                    # 留空允许所有；生产可填 http://你的域名
SCORE_PROVIDER=worldcup26       # 开源世界杯比分源，仅用于比分/结束状态
SCORE_API_BASE_URL=https://worldcup26.ir
SCORE_API_INTERVAL_MS=15000
REQUEST_CONCURRENCY=2
DEFAULT_REQUEST_DELAY_MS=450
ENABLE_MOCK_API=false           # 生产关闭 /api/mock-change 测试接口
```

> **API Key 为空也能启动**：后端会打印明确警告，仅访问无需鉴权的公开端点，不会让前端白屏。Key 只在后端用 `X-API-KEY` 头发送，不会出现在前端代码或构建产物中。

## 重启 / 更新

修改代码或配置后：

```bash
bash /opt/stake-worldcup-odds-monitor/restart.sh
```

会重新安装依赖、重新构建前端、`pm2 reload` 后端、`nginx -t` 并 reload。

## 数据库备份

```bash
bash /opt/stake-worldcup-odds-monitor/backup-db.sh
```

备份写入 `backups/odds-YYYYMMDD-HHMMSS.sqlite`，自动仅保留最近 20 个。建议加到 crontab：

```bash
# 每天 03:17 备份
17 3 * * * bash /opt/stake-worldcup-odds-monitor/backup-db.sh >> /opt/stake-worldcup-odds-monitor/logs/backup.log 2>&1
```

## 部署完成后的验证

```bash
# 查看 PM2 状态
pm2 status

# 查看后端日志
pm2 logs stake-worldcup-odds-backend

# 查看 Nginx 状态
systemctl status nginx

# 健康检查（后端本机）
curl http://127.0.0.1:3001/api/health

# 经 Nginx 的健康检查
curl http://127.0.0.1/api/health

# 测试 SSE（应先收到 connected 事件，保持连接）
curl -N http://127.0.0.1:3001/events

# 调度状态（每场比赛下一次抓取时间 / 最后耗时 / 最后错误）
curl http://127.0.0.1:3001/api/scheduler

# 备份数据库
bash /opt/stake-worldcup-odds-monitor/backup-db.sh

# 重启服务
bash /opt/stake-worldcup-odds-monitor/restart.sh
```

`/api/health` 返回示例字段：

```json
{
  "status": "ok",
  "uptime": 123,
  "version": "0.2.0",
  "database": { "connected": true, "path": "/opt/.../data/odds.sqlite" },
  "sseClients": 1,
  "scheduler": {
    "queueLength": 0,
    "fetchingCount": 1,
    "lastSuccessAt": "2026-06-11T17:00:00.000Z",
    "highFreqCount": 2,
    "lowFreqCount": 30,
    "roundChanges": 3,
    "totalChanges": 128
  }
}
```

## 安全与稳定性

- API Key 仅在服务器 `.env`，不入库、不进前端。
- 前端不直接请求 Stake，所有 Stake 数据请求由后端完成。
- 抓取失败按 5s / 15s / 30s 退避重试，单场失败不影响其他比赛与调度器。
- SSE 断开后前端自动重连，并显示「正在连接 / 服务暂不可用」。
- 后端重启时前端显示「正在连接服务…」，不会白屏。
- `.env`、数据库、日志均已在 `.gitignore` 中忽略，不会提交到 git。

## 防火墙（如启用 ufw）

```bash
sudo ufw allow 'Nginx Full'
```

## 卸载 / 停止

```bash
pm2 delete stake-worldcup-odds-backend
pm2 save
sudo rm -f /etc/nginx/sites-enabled/stake-worldcup-odds
sudo systemctl reload nginx
```
