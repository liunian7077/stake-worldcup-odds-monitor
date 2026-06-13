import React from "react";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  ChevronRight,
  Clock3,
  Flame,
  Gauge,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  Star,
  Trophy,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { MoneylineCards } from "./components/MoneylineCards.jsx";
import { OddsValue } from "./components/OddsValue.jsx";
import { ScoreMatrix } from "./components/ScoreMatrix.jsx";
import { fetchSnapshot, oddsKey, setWatched } from "./lib/api.js";
import { formatDateTime, formatTime } from "./lib/format.js";
import { MARKET_LABELS, MARKET_TYPES, statusLabel } from "./lib/labels.js";

const FLASH_MS = 2000;
const REFRESH_MS = 4000;
const TICK_MS = 30_000;
const HOME_WINDOW_MS = 24 * 60 * 60_000;
const SELECTED_ODDS_STORAGE_KEY = "stake-worldcup:selected-odds:v1";

const OUTCOME_ORDER = { home: 0, draw: 1, away: 2 };

const NAV_ITEMS = [
  { key: "live", label: "实时比赛", icon: Radio },
  { key: "upcoming", label: "即将开始", icon: CalendarClock },
  { key: "watch", label: "关注列表", icon: Star },
  { key: "stats", label: "数据统计", icon: BarChart3 },
  { key: "settings", label: "设置", icon: Settings }
];

const VIEW_COPY = {
  live: {
    title: "实时比赛",
    subtitle: "显示进行中和未来 24 小时内的重点比赛"
  },
  upcoming: {
    title: "即将开始",
    subtitle: "查看 24 小时以后的完整赛程"
  },
  watch: {
    title: "关注列表",
    subtitle: "集中查看你星标关注的比赛"
  },
  stats: {
    title: "数据统计",
    subtitle: "查看赔率数量、变化次数和监控状态"
  },
  settings: {
    title: "设置",
    subtitle: "连接状态、接口路径和刷新策略"
  }
};

const FLAGS = {
  阿尔及利亚: "🇩🇿",
  阿根廷: "🇦🇷",
  澳大利亚: "🇦🇺",
  奥地利: "🇦🇹",
  比利时: "🇧🇪",
  波黑: "🇧🇦",
  巴西: "🇧🇷",
  加拿大: "🇨🇦",
  佛得角: "🇨🇻",
  哥伦比亚: "🇨🇴",
  "刚果（金）": "🇨🇩",
  克罗地亚: "🇭🇷",
  库拉索: "🇨🇼",
  捷克: "🇨🇿",
  厄瓜多尔: "🇪🇨",
  埃及: "🇪🇬",
  英格兰: "🏴",
  法国: "🇫🇷",
  德国: "🇩🇪",
  加纳: "🇬🇭",
  海地: "🇭🇹",
  伊朗: "🇮🇷",
  伊拉克: "🇮🇶",
  科特迪瓦: "🇨🇮",
  日本: "🇯🇵",
  约旦: "🇯🇴",
  韩国: "🇰🇷",
  墨西哥: "🇲🇽",
  摩洛哥: "🇲🇦",
  荷兰: "🇳🇱",
  新西兰: "🇳🇿",
  挪威: "🇳🇴",
  巴拿马: "🇵🇦",
  巴拉圭: "🇵🇾",
  葡萄牙: "🇵🇹",
  卡塔尔: "🇶🇦",
  沙特阿拉伯: "🇸🇦",
  苏格兰: "🏴",
  塞内加尔: "🇸🇳",
  南非: "🇿🇦",
  西班牙: "🇪🇸",
  瑞典: "🇸🇪",
  瑞士: "🇨🇭",
  突尼斯: "🇹🇳",
  土耳其: "🇹🇷",
  美国: "🇺🇸",
  乌拉圭: "🇺🇾",
  乌兹别克斯坦: "🇺🇿"
};

function applyChanges(snapshot, changes) {
  if (!snapshot || !changes.length) {
    return snapshot;
  }

  const changeByKey = new Map(changes.map((change) => [oddsKey(change), change]));

  const fixtures = snapshot.fixtures.map((fixture) => {
    let touched = false;
    const odds = {};
    for (const [marketType, rows] of Object.entries(fixture.odds ?? {})) {
      odds[marketType] = rows.map((row) => {
        const change = changeByKey.get(oddsKey(row));
        if (!change) {
          return row;
        }
        touched = true;
        return {
          ...row,
          odds: change.newOdds,
          previousOdds: change.oldOdds,
          direction: change.direction,
          updatedAt: change.time
        };
      });
    }
    return touched ? { ...fixture, odds, updatedAt: changes[0]?.time ?? fixture.updatedAt } : fixture;
  });

  const scheduler = {
    ...snapshot.scheduler,
    roundChanges: changes.length,
    totalChanges: (snapshot.scheduler?.totalChanges ?? 0) + changes.length,
    lastSuccessAt: changes[0]?.time ?? snapshot.scheduler?.lastSuccessAt
  };

  return {
    ...snapshot,
    fixtures,
    recentChanges: [...changes, ...(snapshot.recentChanges ?? [])].slice(0, 50),
    scheduler
  };
}

function applyScoreChanges(snapshot, changes) {
  if (!snapshot || !changes.length) {
    return snapshot;
  }

  const changeByEvent = new Map(changes.map((change) => [change.eventId, change]));
  const fixtures = snapshot.fixtures.map((fixture) => {
    const change = changeByEvent.get(fixture.slug);
    if (!change) {
      return fixture;
    }

    const score = change.score
      ? {
          ...change.score,
          home: change.homeScore ?? change.score.home,
          away: change.awayScore ?? change.score.away
        }
      : null;

    return {
      ...fixture,
      status: change.status ?? fixture.status,
      homeScore: change.homeScore ?? score?.home ?? fixture.homeScore,
      awayScore: change.awayScore ?? score?.away ?? fixture.awayScore,
      score: score ?? fixture.score,
      scoreUpdatedAt: change.scoreUpdatedAt ?? fixture.scoreUpdatedAt,
      updatedAt: change.time ?? fixture.updatedAt
    };
  });

  const schedulerFixtures = (snapshot.scheduler?.fixtures ?? []).map((fixture) => {
    const change = changeByEvent.get(fixture.matchId);
    if (!change) {
      return fixture;
    }
    return {
      ...fixture,
      status: change.status ?? fixture.status,
      phase: change.phase ?? fixture.phase
    };
  });

  return {
    ...snapshot,
    fixtures,
    scheduler: {
      ...snapshot.scheduler,
      fixtures: schedulerFixtures,
      lastScoreSuccessAt: changes[0]?.time ?? snapshot.scheduler?.lastScoreSuccessAt
    }
  };
}

function readSelectedOdds() {
  try {
    const raw = window.localStorage.getItem(SELECTED_ODDS_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values : []);
  } catch {
    return new Set();
  }
}

function useNowTick() {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function enrichFixtures(snapshot) {
  if (!snapshot) {
    return [];
  }

  const scheduler = new Map((snapshot.scheduler?.fixtures ?? []).map((item) => [item.matchId, item]));
  return snapshot.fixtures.map((fixture) => {
    const meta = scheduler.get(fixture.slug);
    return {
      ...fixture,
      phase: meta?.phase ?? fixture.phase ?? "future",
      status: meta?.status ?? fixture.status,
      isFetching: meta?.isFetching ?? false,
      isWatched: meta?.isWatched ?? false,
      fetchIntervalMs: meta?.fetchIntervalMs ?? null,
      nextFetchAt: meta?.nextFetchAt ?? null,
      lastFetchAt: meta?.lastFetchAt ?? null,
      lastSuccessAt: meta?.lastSuccessAt ?? fixture.updatedAt ?? null,
      lastError: meta?.lastError ?? null
    };
  });
}

function fixtureTeams(fixture) {
  const competitors = fixture?.competitors ?? [];
  if (competitors.length >= 2) {
    return [competitors[0], competitors[1]];
  }

  const parts = String(fixture?.name ?? "").split(/\s+-\s+/);
  return [parts[0] || "主队", parts[1] || "客队"];
}

function teamFlag(name) {
  return FLAGS[name] ?? "🏳️";
}

function visibleMarketRows(fixture, marketType) {
  return (fixture?.odds?.[marketType] ?? []).filter(
    (row) => row.active !== false && Number(row.odds) > 0
  );
}

function moneylineRows(fixture) {
  return [...visibleMarketRows(fixture, MARKET_TYPES.FULL_TIME_1X2)].sort(
    (a, b) => (OUTCOME_ORDER[a.outcomeKey] ?? 9) - (OUTCOME_ORDER[b.outcomeKey] ?? 9)
  );
}

function oddsCount(fixture) {
  return Object.values(fixture?.odds ?? {}).reduce((sum, rows) => {
    return sum + rows.filter((row) => row.active !== false && Number(row.odds) > 0).length;
  }, 0);
}

function formatStartTime(value, now = new Date()) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "--";
  }

  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const label = sameDay(date, today)
    ? "今天"
    : sameDay(date, tomorrow)
      ? "明天"
      : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);

  return `${label} ${formatTime(value)}`;
}

function formatCompact(value) {
  const number = Number(value) || 0;
  if (number >= 10_000) {
    return `${(number / 10_000).toFixed(1)}万`;
  }
  return String(number);
}

function sourceMinuteLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  if (["live", "notstarted", "not started", "null", "none"].includes(normalized)) {
    return null;
  }
  if (["ht", "half-time", "halftime"].includes(normalized)) {
    return "HT";
  }
  if (["ft", "finished", "ended"].includes(normalized)) {
    return "FT";
  }

  const match = text.match(/^(\d{1,3})(?:\s*(?:\+|:)\s*(\d{1,2}))?/);
  if (!match) {
    return text.toUpperCase();
  }

  const minute = Number(match[1]);
  const extra = match[2] ? `+${Number(match[2])}` : "";
  if (!Number.isFinite(minute)) {
    return null;
  }
  return `${minute}${extra}'`;
}

function liveMinute(fixture, now) {
  const fromSource = sourceMinuteLabel(fixture?.score?.timeElapsed);
  if (fromSource) {
    return fromSource;
  }

  const start = Number(fixture?.startTime);
  if (!Number.isFinite(start) || fixture?.phase !== "live") {
    return "--";
  }

  const minute = Math.max(1, Math.floor((now - start) / 60_000) + 1);
  return minute > 90 ? "90+" : `${minute}'`;
}

function isEnded(fixture) {
  return fixture.phase === "ended";
}

function isLive(fixture) {
  return fixture.phase === "live";
}

function isWithinHomeWindow(fixture, now) {
  const start = Number(fixture.startTime);
  return Number.isFinite(start) && start >= now && start <= now + HOME_WINDOW_MS;
}

function buildStats(snapshot, fixtures, followedCount) {
  const scheduler = snapshot?.scheduler ?? {};
  const liveCount = fixtures.filter(isLive).length;
  const upcomingCount = fixtures.filter((fixture) => !isLive(fixture)).length;
  const oddsTotal = fixtures.reduce((sum, fixture) => sum + oddsCount(fixture), 0);

  return {
    liveCount,
    upcomingCount,
    fixtureCount: fixtures.length,
    oddsCount: oddsTotal,
    followedCount,
    roundChanges: scheduler.roundChanges ?? 0,
    totalChanges: scheduler.totalChanges ?? snapshot?.totalChanges ?? 0,
    highFreqCount: scheduler.highFreqCount ?? 0,
    lowFreqCount: scheduler.lowFreqCount ?? 0,
    queueLength: scheduler.queueLength ?? 0,
    fetchingCount: scheduler.fetchingCount ?? 0,
    lastSuccessAt: scheduler.lastSuccessAt ?? null
  };
}

function Sidebar({ activeNav, onNav, connectionState, stats }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Trophy size={23} aria-hidden="true" />
        </div>
        <div>
          <div className="brand-name">Stake World Cup</div>
          <div className="brand-subtitle">Odds Monitor</div>
        </div>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              className={`side-nav-item ${activeNav === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => onNav(item.key)}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-status">
        <div className="status-row">
          <span className={`status-dot ${connectionState}`} />
          <span>系统状态</span>
          <strong>{connectionState === "online" ? "连接正常" : "重连中"}</strong>
        </div>
        <div className="status-separator" />
        <div className="status-grid">
          <span>API</span>
          <strong>/api</strong>
          <span>SSE</span>
          <strong>/events</strong>
          <span>比赛</span>
          <strong>{stats.fixtureCount}</strong>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ activeNav, onNav }) {
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            className={`mobile-nav-item ${activeNav === item.key ? "active" : ""}`}
            key={item.key}
            onClick={() => onNav(item.key)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ConnectionBadge({ state }) {
  const online = state === "online";
  const Icon = online ? Wifi : WifiOff;
  return (
    <div className={`connection-badge ${state}`}>
      <Icon size={17} aria-hidden="true" />
      <span>{online ? "SSE 已连接" : state === "connecting" ? "SSE 重连中" : "SSE 离线"}</span>
    </div>
  );
}

function TopStatusBar({ activeNav, stats, connectionState, onRefresh }) {
  const copy = VIEW_COPY[activeNav] ?? VIEW_COPY.live;
  return (
    <header className="top-status">
      <div className="title-block">
        <div className="title-line">
          <h1>{copy.title}</h1>
          <span className="live-badge">LIVE</span>
        </div>
        <p>{copy.subtitle}</p>
      </div>

      <div className="status-cards">
        <div className="countdown-card">
          <Clock3 size={26} aria-hidden="true" />
          <div>
            <span>刷新方式</span>
            <strong>SSE 实时推送</strong>
            <small>后台自动轮询 Stake 赔率</small>
          </div>
        </div>
        <MetricCard label="今日比赛" value={stats.fixtureCount} tone="neutral" />
        <MetricCard label="首页重点" value={stats.homeCount ?? stats.liveCount} tone="green" />
        <MetricCard label="即将开始" value={stats.upcomingCount} tone="amber" />
        <MetricCard label="关注比赛" value={stats.followedCount} tone="purple" />
      </div>

      <div className="top-actions">
        <ConnectionBadge state={connectionState} />
        <button type="button" className="icon-action" onClick={onRefresh} aria-label="刷新数据">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function MetricCard({ label, value, tone }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>场</small>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, badge, actionLabel, onAction }) {
  return (
    <div className="section-header">
      <div className="section-title">
        <Icon size={20} aria-hidden="true" />
        <h2>{title}</h2>
        {badge ? <span className="section-badge">{badge}</span> : null}
      </div>
      {actionLabel ? (
        <button type="button" className="ghost-button" onClick={onAction}>
          <span>{actionLabel}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function TeamName({ name }) {
  return (
    <span className="team-name">
      <span className="flag" aria-hidden="true">
        {teamFlag(name)}
      </span>
      <span>{name}</span>
    </span>
  );
}

function OddsPill({ row, type, label, flash, selectedOdds = new Set(), onToggleOdds = () => {} }) {
  const flashDir = row ? flash[oddsKey(row)] : "";
  const selected = row ? selectedOdds.has(oddsKey(row)) : false;

  return (
    <button
      type="button"
      className={`odds-pill ${type} ${selected ? "selected" : ""}`}
      disabled={!row}
      aria-pressed={selected}
      title={selected ? "取消选择" : "选择该赔率"}
      onClick={(event) => {
        event.stopPropagation();
        onToggleOdds(row);
      }}
    >
      <span className="odds-label">{label}</span>
      <OddsValue value={row?.odds} direction={flashDir} />
    </button>
  );
}

function MatchOdds({ fixture, flash, selectedOdds, onToggleOdds }) {
  const rows = moneylineRows(fixture);
  const byOutcome = new Map(rows.map((row) => [row.outcomeKey, row]));

  return (
    <div className="odds-row">
      <OddsPill
        row={byOutcome.get("home")}
        type="home"
        label="主胜"
        flash={flash}
        selectedOdds={selectedOdds}
        onToggleOdds={onToggleOdds}
      />
      <OddsPill
        row={byOutcome.get("draw")}
        type="draw"
        label="平局"
        flash={flash}
        selectedOdds={selectedOdds}
        onToggleOdds={onToggleOdds}
      />
      <OddsPill
        row={byOutcome.get("away")}
        type="away"
        label="客胜"
        flash={flash}
        selectedOdds={selectedOdds}
        onToggleOdds={onToggleOdds}
      />
    </div>
  );
}

function ScoreDisplay({ fixture }) {
  const homeScore = fixture.homeScore ?? fixture.score?.home ?? fixture.score?.homeScore;
  const awayScore = fixture.awayScore ?? fixture.score?.away ?? fixture.score?.awayScore;
  const hasScore = Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore));
  const scoreStatus = String(fixture.score?.status ?? fixture.score?.timeElapsed ?? "").toLowerCase();
  const showScore =
    hasScore &&
    (fixture.phase === "live" ||
      fixture.phase === "ended" ||
      scoreStatus === "live" ||
      scoreStatus === "finished");

  if (!showScore) {
    return (
      <div className="score-display placeholder not-started">
        <strong className="score-status-text">未开赛</strong>
      </div>
    );
  }

  return (
    <div className="score-display">
      <strong>{homeScore}</strong>
      <span>-</span>
      <strong>{awayScore}</strong>
    </div>
  );
}

function LiveMatchCard({
  fixture,
  flash,
  now,
  followed,
  reminded,
  selectedOdds,
  onOpen,
  onToggleFollow,
  onToggleRemind,
  onToggleOdds
}) {
  const [home, away] = fixtureTeams(fixture);
  const live = isLive(fixture);
  const timingLabel = live ? liveMinute(fixture, now) : formatStartTime(fixture.startTime, new Date(now));
  const statusText = live ? "LIVE" : statusLabel(fixture.status, fixture.phase);

  return (
    <article className={`live-card ${live ? "is-live" : "is-soon"}`} onClick={() => onOpen(fixture)} tabIndex={0}>
      <div className="live-card-top">
        <span className="minute-pill">{timingLabel}</span>
        <span className="tournament-label">{fixture.tournament || "世界杯 2026"}</span>
        <span className={`live-chip ${live ? "" : "soon"}`}>{statusText}</span>
      </div>

      <div className="teams-score">
        <div className="team-stack">
          <span className="large-flag">{teamFlag(home)}</span>
          <strong>{home}</strong>
        </div>
        <ScoreDisplay fixture={fixture} />
        <div className="team-stack right">
          <span className="large-flag">{teamFlag(away)}</span>
          <strong>{away}</strong>
        </div>
      </div>

      <MatchOdds
        fixture={fixture}
        flash={flash}
        selectedOdds={selectedOdds}
        onToggleOdds={onToggleOdds}
      />

      <div className="live-card-foot">
        <span className="heat">
          <Flame size={15} aria-hidden="true" />
          {formatCompact(oddsCount(fixture))} 条赔率
        </span>
        <div className="card-actions">
          <button
            type="button"
            className={`tiny-icon ${followed ? "active" : ""}`}
            aria-label="关注比赛"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFollow(fixture);
            }}
          >
            <Star size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`tiny-icon ${reminded ? "active" : ""}`}
            aria-label="赔率提醒"
            onClick={(event) => {
              event.stopPropagation();
              onToggleRemind(fixture);
            }}
          >
            <Bell size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function LiveMatches({
  fixtures,
  flash,
  now,
  followed,
  reminded,
  selectedOdds,
  onOpen,
  onToggleFollow,
  onToggleRemind,
  onToggleOdds
}) {
  return (
    <section className="panel live-section" id="live-section">
      <SectionHeader icon={Activity} title="实时与近 24 小时" badge="重点" />
      {fixtures.length ? (
        <div className="live-grid">
          {fixtures.map((fixture) => (
            <LiveMatchCard
              fixture={fixture}
              flash={flash}
              now={now}
              followed={followed.has(fixture.slug) || fixture.isWatched}
              reminded={reminded.has(fixture.slug)}
              selectedOdds={selectedOdds}
              key={fixture.slug}
              onOpen={onOpen}
              onToggleFollow={onToggleFollow}
              onToggleRemind={onToggleRemind}
              onToggleOdds={onToggleOdds}
            />
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <Radio size={28} aria-hidden="true" />
          <strong>暂无近 24 小时比赛</strong>
          <span>已结束比赛会自动隐藏；24 小时以后的赛程在“即将开始”里查看。</span>
        </div>
      )}
    </section>
  );
}

function UpcomingMatches({
  fixtures,
  flash,
  now,
  followed,
  reminded,
  selectedOdds,
  onOpen,
  onToggleFollow,
  onToggleRemind,
  onToggleOdds,
  title = "即将开始的比赛",
  actionLabel = "查看全部即将开始比赛",
  emptyTitle = "暂无未开始比赛",
  emptyText = "下一轮比赛出现后会自动进入列表。"
}) {
  return (
    <section className="panel upcoming-section" id="upcoming-section">
      <SectionHeader icon={Clock3} title={title} actionLabel={actionLabel} />

      {fixtures.length ? (
        <>
          <div className="table-wrap">
            <table className="upcoming-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>赛事</th>
                  <th>主队</th>
                  <th>VS</th>
                  <th>客队</th>
                  <th>赔率</th>
                  <th>最后更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {fixtures.map((fixture) => {
                  const [home, away] = fixtureTeams(fixture);
                  return (
                    <tr key={fixture.slug} onClick={() => onOpen(fixture)}>
                      <td>{formatStartTime(fixture.startTime, new Date(now))}</td>
                      <td>{fixture.tournament || "世界杯 2026"}</td>
                      <td>
                        <TeamName name={home} />
                      </td>
                      <td className="vs-cell">VS</td>
                      <td>
                        <TeamName name={away} />
                      </td>
                      <td>
                        <MatchOdds
                          fixture={fixture}
                          flash={flash}
                          selectedOdds={selectedOdds}
                          onToggleOdds={onToggleOdds}
                        />
                      </td>
                      <td className="countdown-cell">
                        {formatDateTime(fixture.lastSuccessAt ?? fixture.updatedAt)}
                      </td>
                      <td>
                        <RowActions
                          fixture={fixture}
                          followed={followed.has(fixture.slug) || fixture.isWatched}
                          reminded={reminded.has(fixture.slug)}
                          onOpen={onOpen}
                          onToggleFollow={onToggleFollow}
                          onToggleRemind={onToggleRemind}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="upcoming-cards">
            {fixtures.map((fixture) => {
              const [home, away] = fixtureTeams(fixture);
              return (
                <article className="upcoming-card" key={fixture.slug} onClick={() => onOpen(fixture)}>
                  <div className="upcoming-card-head">
                    <span>{formatStartTime(fixture.startTime, new Date(now))}</span>
                    <strong>{statusLabel(fixture.status, fixture.phase)}</strong>
                  </div>
                  <div className="upcoming-teams">
                    <TeamName name={home} />
                    <span>VS</span>
                    <TeamName name={away} />
                  </div>
                  <MatchOdds
                    fixture={fixture}
                    flash={flash}
                    selectedOdds={selectedOdds}
                    onToggleOdds={onToggleOdds}
                  />
                  <div className="upcoming-card-foot">
                    <span>更新 {formatDateTime(fixture.lastSuccessAt ?? fixture.updatedAt)}</span>
                    <RowActions
                      fixture={fixture}
                      followed={followed.has(fixture.slug) || fixture.isWatched}
                      reminded={reminded.has(fixture.slug)}
                      onOpen={onOpen}
                      onToggleFollow={onToggleFollow}
                      onToggleRemind={onToggleRemind}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty-panel">
          <CalendarClock size={28} aria-hidden="true" />
          <strong>{emptyTitle}</strong>
          <span>{emptyText}</span>
        </div>
      )}
    </section>
  );
}

function RowActions({ fixture, followed, reminded, onOpen, onToggleFollow, onToggleRemind }) {
  return (
    <div className="row-actions">
      <button
        type="button"
        className={`tiny-icon ${followed ? "active" : ""}`}
        aria-label="关注比赛"
        onClick={(event) => {
          event.stopPropagation();
          onToggleFollow(fixture);
        }}
      >
        <Star size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`tiny-icon ${reminded ? "active" : ""}`}
        aria-label="赔率提醒"
        onClick={(event) => {
          event.stopPropagation();
          onToggleRemind(fixture);
        }}
      >
        <Bell size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tiny-icon"
        aria-label="查看盘口详情"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(fixture);
        }}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

function InfoPanels({ stats, followedFixtures, connectionState }) {
  return (
    <div className="info-grid" id="stats-section">
      <section className="panel info-panel">
        <SectionHeader icon={Gauge} title="数据统计" />
        <div className="info-metrics">
          <InfoMetric label="当前赔率数" value={formatCompact(stats.oddsCount)} />
          <InfoMetric label="本轮变化" value={stats.roundChanges} />
          <InfoMetric label="累计变化" value={formatCompact(stats.totalChanges)} />
          <InfoMetric label="高频监控" value={stats.highFreqCount} />
        </div>
      </section>

      <section className="panel info-panel">
        <SectionHeader icon={Star} title="关注的比赛" />
        {followedFixtures.length ? (
          <div className="follow-list">
            {followedFixtures.slice(0, 4).map((fixture) => (
              <button type="button" key={fixture.slug} className="follow-row">
                <span>{fixture.name}</span>
                <strong>{statusLabel(fixture.status, fixture.phase)}</strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="quiet-empty">点击星标后会显示在这里。</div>
        )}
      </section>

      <section className="panel info-panel">
        <SectionHeader icon={ShieldCheck} title="系统信息" />
        <div className="system-list">
          <span>最后更新</span>
          <strong>{formatDateTime(stats.lastSuccessAt)}</strong>
          <span>刷新策略</span>
          <strong>SSE 推送 + 后台轮询</strong>
          <span>连接状态</span>
          <strong className={connectionState === "online" ? "text-green" : "text-amber"}>
            {connectionState === "online" ? "正常" : "重连中"}
          </strong>
        </div>
      </section>
    </div>
  );
}

function InfoMetric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsView({ stats, connectionState, onRefresh }) {
  return (
    <section className="panel settings-panel">
      <SectionHeader icon={Settings} title="设置" />
      <div className="settings-grid">
        <div className="settings-card">
          <span>接口路径</span>
          <strong>/api</strong>
          <small>通过 Nginx 代理到后端 3001</small>
        </div>
        <div className="settings-card">
          <span>实时通道</span>
          <strong>/events</strong>
          <small>SSE 连接状态：{connectionState === "online" ? "正常" : "重连中"}</small>
        </div>
        <div className="settings-card">
          <span>刷新策略</span>
          <strong>后台自动轮询</strong>
          <small>赔率变化通过 SSE 推送到前端</small>
        </div>
        <div className="settings-card">
          <span>最后更新</span>
          <strong>{formatDateTime(stats.lastSuccessAt)}</strong>
          <small>当前页面只显示状态信息</small>
        </div>
      </div>
      <div className="settings-actions">
        <button type="button" className="ghost-button keep-visible" onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>立即刷新</span>
        </button>
      </div>
    </section>
  );
}

function DetailModal({ fixture, flash, now, selectedOdds, onToggleOdds, onClose }) {
  const [tab, setTab] = React.useState("full");

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!fixture) {
    return null;
  }

  const [home, away] = fixtureTeams(fixture);
  const moneylineType =
    tab === "full" ? MARKET_TYPES.FULL_TIME_1X2 : MARKET_TYPES.HALF_TIME_1X2;
  const scoreType =
    tab === "full" ? MARKET_TYPES.FULL_TIME_CORRECT_SCORE : MARKET_TYPES.HALF_TIME_CORRECT_SCORE;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭详情">
          <X size={20} aria-hidden="true" />
        </button>

        <div className="modal-scoreline">
          <TeamName name={home} />
          <ScoreDisplay fixture={fixture} />
          <TeamName name={away} />
        </div>

        <div className="detail-tabs">
          <button
            type="button"
            className={tab === "full" ? "active" : ""}
            onClick={() => setTab("full")}
          >
            全场
          </button>
          <button
            type="button"
            className={tab === "half" ? "active" : ""}
            onClick={() => setTab("half")}
          >
            半场
          </button>
        </div>

        <div className="detail-scroll">
          <section className="detail-block">
            <h3>{MARKET_LABELS[moneylineType]}</h3>
            <MoneylineCards
              marketType={moneylineType}
              rows={visibleMarketRows(fixture, moneylineType)}
              flash={flash}
              home={home}
              away={away}
              selectedOdds={selectedOdds}
              onToggleOdds={onToggleOdds}
            />
          </section>

          <section className="detail-block">
            <h3>{MARKET_LABELS[scoreType]}</h3>
            <ScoreMatrix
              marketType={scoreType}
              rows={visibleMarketRows(fixture, scoreType)}
              flash={flash}
              home={home}
              away={away}
              selectedOdds={selectedOdds}
              onToggleOdds={onToggleOdds}
            />
          </section>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = React.useState(null);
  const [flash, setFlash] = React.useState({});
  const [connectionState, setConnectionState] = React.useState("connecting");
  const [error, setError] = React.useState("");
  const [activeNav, setActiveNav] = React.useState("live");
  const [detailSlug, setDetailSlug] = React.useState("");
  const [followed, setFollowed] = React.useState(() => new Set());
  const [reminded, setReminded] = React.useState(() => new Set());
  const [selectedOdds, setSelectedOdds] = React.useState(readSelectedOdds);
  const flashTimers = React.useRef(new Map());
  const now = useNowTick();

  const refresh = React.useCallback(async () => {
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
      setError("");
    } catch (fetchError) {
      setError(fetchError.message);
    }
  }, []);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        SELECTED_ODDS_STORAGE_KEY,
        JSON.stringify([...selectedOdds])
      );
    } catch {
      // 浏览器禁止 localStorage 时，选择状态仍保留在当前页面会话中。
    }
  }, [selectedOdds]);

  React.useEffect(() => {
    const events = new EventSource("/events");

    events.addEventListener("connected", () => {
      setConnectionState("online");
      setError("");
    });

    events.addEventListener("odds-change", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const changes = payload.changes ?? [];
      if (!changes.length) {
        return;
      }

      const patch = Object.fromEntries(changes.map((change) => [oddsKey(change), change.direction]));
      setFlash((current) => ({ ...current, ...patch }));
      setSnapshot((current) => applyChanges(current, changes));

      for (const key of Object.keys(patch)) {
        const existing = flashTimers.current.get(key);
        if (existing) {
          window.clearTimeout(existing);
        }
        const timer = window.setTimeout(() => {
          setFlash((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
          flashTimers.current.delete(key);
        }, FLASH_MS);
        flashTimers.current.set(key, timer);
      }
    });

    events.addEventListener("score-change", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const changes = payload.changes ?? [];
      if (!changes.length) {
        return;
      }

      setSnapshot((current) => applyScoreChanges(current, changes));
    });

    events.onopen = () => setConnectionState("online");
    events.onerror = () => {
      setConnectionState((current) => (current === "online" ? "connecting" : "offline"));
    };

    return () => {
      events.close();
      for (const timer of flashTimers.current.values()) {
        window.clearTimeout(timer);
      }
      flashTimers.current.clear();
    };
  }, []);

  const allFixtures = React.useMemo(() => {
    return enrichFixtures(snapshot)
      .filter((fixture) => !isEnded(fixture))
      .sort((a, b) => Number(a.startTime ?? 0) - Number(b.startTime ?? 0));
  }, [snapshot]);

  const homeFixtures = React.useMemo(
    () => allFixtures.filter((fixture) => isLive(fixture) || isWithinHomeWindow(fixture, now)),
    [allFixtures, now]
  );
  const upcomingFixtures = React.useMemo(
    () => allFixtures.filter((fixture) => !isLive(fixture) && !isWithinHomeWindow(fixture, now)),
    [allFixtures, now]
  );
  const followedFixtures = React.useMemo(
    () => allFixtures.filter((fixture) => followed.has(fixture.slug) || fixture.isWatched),
    [allFixtures, followed]
  );
  const stats = React.useMemo(
    () => ({
      ...buildStats(snapshot, allFixtures, followedFixtures.length),
      homeCount: homeFixtures.length,
      upcomingCount: upcomingFixtures.length
    }),
    [snapshot, allFixtures, followedFixtures.length, homeFixtures.length, upcomingFixtures.length]
  );
  const detailFixture = allFixtures.find((fixture) => fixture.slug === detailSlug) ?? null;

  const openFixture = React.useCallback((fixture) => {
    setDetailSlug(fixture.slug);
    setWatched(fixture.slug);
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!detailSlug) {
      return undefined;
    }

    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [detailSlug, refresh]);

  const toggleFollow = React.useCallback((fixture) => {
    setFollowed((current) => {
      const next = new Set(current);
      if (next.has(fixture.slug)) {
        next.delete(fixture.slug);
      } else {
        next.add(fixture.slug);
        setWatched(fixture.slug);
      }
      return next;
    });
  }, []);

  const toggleRemind = React.useCallback((fixture) => {
    setReminded((current) => {
      const next = new Set(current);
      if (next.has(fixture.slug)) {
        next.delete(fixture.slug);
      } else {
        next.add(fixture.slug);
      }
      return next;
    });
  }, []);

  const toggleOddsSelection = React.useCallback((row) => {
    if (!row) {
      return;
    }
    const key = oddsKey(row);
    setSelectedOdds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        activeNav={activeNav}
        onNav={setActiveNav}
        connectionState={connectionState}
        stats={stats}
      />

      <main className="main-shell">
        <TopStatusBar
          activeNav={activeNav}
          stats={stats}
          connectionState={connectionState}
          onRefresh={refresh}
        />

        {error ? <div className="error-banner">{error}</div> : null}

        {!snapshot ? (
          <div className="loading-state">正在连接赔率服务...</div>
        ) : (
          <>
            {activeNav === "live" ? (
              <LiveMatches
                fixtures={homeFixtures}
                flash={flash}
                now={now}
                followed={followed}
                reminded={reminded}
                selectedOdds={selectedOdds}
                onOpen={openFixture}
                onToggleFollow={toggleFollow}
                onToggleRemind={toggleRemind}
                onToggleOdds={toggleOddsSelection}
              />
            ) : null}

            {activeNav === "upcoming" ? (
              <UpcomingMatches
                fixtures={upcomingFixtures}
                flash={flash}
                now={now}
                followed={followed}
                reminded={reminded}
                selectedOdds={selectedOdds}
                onOpen={openFixture}
                onToggleFollow={toggleFollow}
                onToggleRemind={toggleRemind}
                onToggleOdds={toggleOddsSelection}
              />
            ) : null}

            {activeNav === "watch" ? (
              <UpcomingMatches
                fixtures={followedFixtures}
                flash={flash}
                now={now}
                followed={followed}
                reminded={reminded}
                selectedOdds={selectedOdds}
                onOpen={openFixture}
                onToggleFollow={toggleFollow}
                onToggleRemind={toggleRemind}
                onToggleOdds={toggleOddsSelection}
                title="关注列表"
                actionLabel=""
                emptyTitle="还没有关注比赛"
                emptyText="点击比赛右侧的星标后，会在这里集中显示。"
              />
            ) : null}

            {activeNav === "stats" ? (
              <InfoPanels
                stats={stats}
                followedFixtures={followedFixtures}
                connectionState={connectionState}
              />
            ) : null}

            {activeNav === "settings" ? (
              <SettingsView
                stats={stats}
                connectionState={connectionState}
                onRefresh={refresh}
              />
            ) : null}
          </>
        )}
      </main>

      <MobileNav activeNav={activeNav} onNav={setActiveNav} />

      <DetailModal
        fixture={detailFixture}
        flash={flash}
        now={now}
        selectedOdds={selectedOdds}
        onToggleOdds={toggleOddsSelection}
        onClose={() => setDetailSlug("")}
      />
    </div>
  );
}
