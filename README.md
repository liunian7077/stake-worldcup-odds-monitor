# Stake 世界杯赔率监控系统

一个**只读**的网页端实时赔率监控面板，用于拉取 Stake 足球世界杯赛事赔率，标准化、记录并监控变化：

- 全场独赢 / 1X2
- 全场正确比分
- 半场独赢
- 半场正确比分
- 赔率变化历史 + 变化百分比
- SSE 实时推送 + 卡片高亮
- 按比赛独立调度，当前比赛 / 滚球比赛高频刷新

本项目**不包含也不应添加**任何自动下注、模拟下注、Stake 登录、下注提交、充值、提现、余额、资金、钱包、账户 Token 相关功能。所有与投注提交、资金、余额相关的接口、按钮、字段都不实现。

## 技术栈

- Node.js + Fastify（后端，端口 `3001`）
- React + Vite（前端）
- SQLite（`node:sqlite`，需 Node ≥ 22.5 本地开发 / 生产用 Node 20 LTS）
- SSE 实时推送
- Ubuntu + Nginx + PM2（部署）

## 调度架构（按比赛独立调度）

不再使用「固定 30 秒全量轮询 64 场」的模式。调度器每 1 秒检查一次，只把到期的比赛加入抓取队列：

| 比赛状态 | 刷新频率 |
| --- | --- |
| 当前选中 / 高频监控 | ~1.5 秒 |
| 进行中（滚球） | ~2 秒 |
| 30 分钟内开赛 | ~8 秒 |
| 今日未开赛 | ~45 秒 |
| 未来比赛 | 5 分钟 |
| 已结束 | 停止 |

- 抓取队列并发限制（默认 2），请求间有最小间隔。
- 单场抓取失败按 5s / 15s / 30s 退避重试，不阻塞其他比赛与调度器。
- 前端切换比赛会通过 `POST /api/watch` 通知后端把该场升为高频监控；旧的非滚球比赛自动降频。
- 比赛列表本身低频刷新，当前比赛详情高频刷新——缩小高频范围会**真实减少**后端请求量。

## 数据流

```text
Stake Odds Data API
  -> 按比赛独立调度器 (scheduler) + 抓取队列 (fetchQueue, 并发受限)
  -> 标准化 4 类盘口 (normalize)
  -> SQLite current_odds / odds_history（仅数值变化才写历史）
  -> SSE /events 推送 odds-change
  -> React 面板（顶部状态栏 + 比赛列表 + 比赛详情 + 最近变化）
```

## 环境变量

复制示例文件：

```bash
cp .env.example .env
```

重要变量：

```bash
PORT=3001
STAKE_ODDS_API_KEY=
STAKE_ODDS_API_BASE_URL=https://odds-data.stake.com
DATABASE_URL=./data/stake-odds.sqlite
SCORE_PROVIDER=worldcup26
SCORE_API_BASE_URL=https://worldcup26.ir
SCORE_API_INTERVAL_MS=15000
REQUEST_CONCURRENCY=2
DEFAULT_REQUEST_DELAY_MS=450
ENABLE_MOCK_API=true   # 开发期开启 /api/mock-change，生产应设为 false
```

`STAKE_ODDS_API_KEY` 只在后端读取，用 `X-API-KEY` header 发送。不要把 token 写入前端代码、构建产物或浏览器 localStorage。Key 为空也能启动，后端会打印警告并仅访问无需鉴权的端点。

`SCORE_PROVIDER=worldcup26` 会接入开源世界杯比分接口，仅用于比分和比赛结束状态展示；不涉及登录、下注或资金相关功能。

## 本地开发

```bash
npm install
npm run dev
```

默认地址：

- 前端 Vite：`http://localhost:5173`
- 后端 API：`http://localhost:3001`

常用检查：

```bash
npm run smoke   # 盘口标准化（含半场）单测
npm run lint
npm run build
npm start       # 生产模式（先 build，Fastify 会托管 client/dist）
```

## API

```text
GET  /api/health      健康检查 + 调度器统计
GET  /api/snapshot    比赛 + 4 类当前赔率 + 最近变化 + 调度状态
GET  /api/scheduler   每场比赛的下一次抓取时间 / 最后耗时 / 最后错误
GET  /api/changes?limit=50
POST /api/watch       { slug } 设置当前高频监控比赛
POST /api/mock-change 开发测试：模拟一次赔率变化（生产默认关闭）
GET  /events          SSE（兼容 /api/events）
```

SSE 事件类型：`connected`、`odds-change`。

## 盘口标准化

支持 4 类 `marketType`，并兼容不同数据源的多种 marketName 写法：

| marketType | 显示名 | 兼容写法（示例） |
| --- | --- | --- |
| `full_time_1x2` | 全场独赢 | 1X2 / Moneyline / Match Winner / Full Time Result |
| `full_time_correct_score` | 全场正确比分 | Correct Score / Full Time Correct Score |
| `half_time_1x2` | 半场独赢 | Half Time Result / 1st Half 1X2 / Half Time 1X2 |
| `half_time_correct_score` | 半场正确比分 | Half Time Correct Score / 1st Half Correct Score |

赔率的稳定身份键是 `eventId + marketType + outcomeName`（不依赖会变化的 marketId / outcomeId）。首次抓取只建立 baseline，不计入变化。

## SQLite 表

```text
fixtures       世界杯比赛基础信息
current_odds   当前标准化赔率（含 prev_odds、last_direction）
odds_history   赔率变化历史（含 market_type、change_percent）
```

## 部署

完整的日本 Ubuntu 服务器自动部署方案见 **[README_DEPLOY.md](./README_DEPLOY.md)**：

```bash
bash deploy.sh
```

包含：Node 20 LTS + PM2 + Nginx 反代（含 SSE 关闭缓冲）+ SQLite 持久化 + 一键部署 / 重启 / 备份脚本。

## 只读边界

代码中没有 Stake 登录、用户 token 采集、下注 mutation、资金接口或浏览器自动化。后续扩展也应保持这个边界：只读取公开/授权赔率数据，只展示、记录和监控变化。
