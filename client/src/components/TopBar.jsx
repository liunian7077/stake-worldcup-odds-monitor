import { Activity, RefreshCw, Wifi, WifiOff, Zap } from "lucide-react";
import { formatClock } from "../lib/format.js";

const CONNECTION = {
  online: { label: "SSE 已连接", className: "online", Icon: Wifi },
  connecting: { label: "正在连接", className: "connecting", Icon: Wifi },
  offline: { label: "服务暂不可用", className: "offline", Icon: WifiOff }
};

function Stat({ label, value, accent }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function TopBar({ stats, connectionState, onRefresh, onMock, showMock }) {
  const conn = CONNECTION[connectionState] ?? CONNECTION.connecting;
  const ConnIcon = conn.Icon;

  return (
    <header className="topbar">
      <div className="topbar-head">
        <div className="brand">
          <h1>Stake 世界杯赔率监控</h1>
          <div className="subline">全场 / 半场 · 独赢 · 正确比分 · 实时变化监控</div>
        </div>
        <div className="toolbar">
          <div className={`status-pill ${conn.className}`}>
            <ConnIcon size={16} aria-hidden="true" />
            <span>{conn.label}</span>
          </div>
          {showMock ? (
            <button className="text-button" type="button" onClick={onMock} title="模拟一次赔率变化">
              <Zap size={15} aria-hidden="true" />
              模拟变化
            </button>
          ) : null}
          <button className="icon-button" type="button" onClick={onRefresh} title="手动刷新" aria-label="手动刷新">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="stat-strip">
        <Stat label="比赛数" value={stats.fixtureCount} />
        <Stat label="当前赔率数" value={stats.oddsCount} />
        <Stat label="本轮变化" value={stats.roundChanges} accent={stats.roundChanges > 0} />
        <Stat label="累计变化" value={stats.totalChanges} />
        <Stat label="高频监控" value={stats.highFreqCount} accent={stats.highFreqCount > 0} />
        <Stat label="低频监控" value={stats.lowFreqCount} />
        <Stat label="队列长度" value={stats.queueLength} />
        <Stat label="抓取中" value={stats.fetchingCount} />
        <div className="stat last-update">
          <span className="stat-value">
            <Activity size={14} aria-hidden="true" /> {stats.lastSuccessAt ? formatClock(stats.lastSuccessAt) : "--"}
          </span>
          <span className="stat-label">最后更新</span>
        </div>
      </div>
    </header>
  );
}
