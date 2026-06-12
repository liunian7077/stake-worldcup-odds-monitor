import React from "react";
import { Search, Zap } from "lucide-react";
import { dateGroupLabel, formatTime, isToday } from "../lib/format.js";
import { statusLabel } from "../lib/labels.js";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "today", label: "今日" },
  { key: "live", label: "滚球" },
  { key: "upcoming", label: "未开赛" },
  { key: "ended", label: "已结束" }
];

function matchesFilter(fixture, filter) {
  switch (filter) {
    case "today":
      return isToday(fixture.startTime);
    case "live":
      return fixture.phase === "live";
    case "upcoming":
      return fixture.phase !== "live" && fixture.phase !== "ended";
    case "ended":
      return fixture.phase === "ended";
    default:
      return true;
  }
}

function groupByDate(fixtures) {
  const groups = new Map();
  for (const fixture of fixtures) {
    const label = dateGroupLabel(fixture.startTime);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(fixture);
  }
  return [...groups.entries()];
}

export function MatchList({ fixtures, selectedSlug, onSelect }) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");

  const filtered = fixtures.filter((fixture) => {
    if (!matchesFilter(fixture, filter)) {
      return false;
    }
    if (!search.trim()) {
      return true;
    }
    return fixture.name.toLowerCase().includes(search.trim().toLowerCase());
  });

  const groups = groupByDate(filtered);

  return (
    <aside className="match-list" aria-label="比赛列表">
      <div className="panel-title">
        比赛列表
        <span className="panel-count">{filtered.length}</span>
      </div>

      <div className="match-controls">
        <div className="search-box">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder="搜索比赛"
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索比赛"
          />
        </div>
        <div className="filter-row">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`filter-chip ${filter === item.key ? "active" : ""}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="match-scroll">
        {groups.length === 0 ? (
          <div className="empty-state">没有符合条件的比赛</div>
        ) : (
          groups.map(([label, items]) => (
            <div className="match-group" key={label}>
              <div className="match-group-title">{label}</div>
              {items.map((fixture) => (
                <button
                  className={`match-row ${fixture.slug === selectedSlug ? "selected" : ""}`}
                  key={fixture.slug}
                  onClick={() => onSelect(fixture.slug)}
                  type="button"
                >
                  <span className="match-name">{fixture.name}</span>
                  <span className="match-meta">
                    <span className="match-time">{formatTime(fixture.startTime)}</span>
                    <span className={`match-status status-${fixture.phase ?? "future"}`}>
                      {statusLabel(fixture.status, fixture.phase)}
                    </span>
                    {fixture.isWatched ? (
                      <span className="watched-badge" title="高频监控中">
                        <Zap size={12} aria-hidden="true" /> 高频
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
