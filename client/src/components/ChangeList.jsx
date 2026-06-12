import { TrendingDown, TrendingUp } from "lucide-react";
import { formatDateTime, formatOdds, formatPercent } from "../lib/format.js";
import { outcomeLabel } from "../lib/labels.js";

function inferOutcomeKey(outcomeName) {
  const n = String(outcomeName ?? "").toLowerCase();
  if (n === "draw" || n === "x" || n === "tie") {
    return "draw";
  }
  if (n === "1" || n === "home" || n.includes("home")) {
    return "home";
  }
  if (n === "2" || n === "away" || n.includes("away")) {
    return "away";
  }
  return null;
}

function outcomeText(change) {
  if (/\d+\s*[:\-]\s*\d+/.test(change.outcomeName ?? "")) {
    return change.outcomeName; // 比分保持原样
  }
  const key = change.outcomeKey ?? inferOutcomeKey(change.outcomeName);
  if (key) {
    return outcomeLabel(change.marketType, key, change.outcomeName);
  }
  return change.outcomeName;
}

function changeKey(change) {
  return change.id ?? `${change.time}:${change.eventId}:${change.marketType}:${change.outcomeName}`;
}

export function ChangeList({ changes }) {
  return (
    <aside className="changes-panel" aria-label="最近赔率变化">
      <div className="panel-title">
        最近变化
        <span className="panel-count">{changes.length}</span>
      </div>
      <div className="change-scroll">
        {changes.length === 0 ? (
          <div className="empty-state">暂无赔率变化</div>
        ) : (
          changes.map((change) => (
            <div className={`change-row ${change.direction}`} key={changeKey(change)}>
              <div className="change-top">
                <span className="change-match">{change.matchName}</span>
                <span className="change-time">{formatDateTime(change.time)}</span>
              </div>
              <div className="change-mid">
                <span className="change-market">{change.marketDisplayName}</span>
                <span className="change-outcome">{outcomeText(change)}</span>
              </div>
              <div className="change-bottom">
                <span className="change-odds">
                  {formatOdds(change.oldOdds)} → {formatOdds(change.newOdds)}
                </span>
                <span className={`change-pct ${change.direction}`}>
                  {change.direction === "up" ? (
                    <TrendingUp size={14} aria-hidden="true" />
                  ) : (
                    <TrendingDown size={14} aria-hidden="true" />
                  )}
                  {formatPercent(change.changePercent)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
