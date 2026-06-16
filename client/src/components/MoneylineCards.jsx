import { oddsKey } from "../lib/api.js";
import { formatOdds } from "../lib/format.js";
import { EMPTY_MARKET_HINTS, outcomeLabel } from "../lib/labels.js";
import { OddsValue } from "./OddsValue.jsx";

const ORDER = { home: 0, draw: 1, away: 2 };

function teamLabel(outcomeKey, home, away, fallback) {
  if (outcomeKey === "home") {
    return home || fallback;
  }
  if (outcomeKey === "away") {
    return away || fallback;
  }
  if (outcomeKey === "draw") {
    return "平局";
  }
  return fallback;
}

export function MoneylineCards({
  marketType,
  rows,
  flash,
  home,
  away,
  selectedOdds = new Set(),
  onToggleOdds = () => {}
}) {
  if (!rows || rows.length === 0) {
    return <div className="empty-state">{EMPTY_MARKET_HINTS[marketType]}</div>;
  }

  const sorted = [...rows].sort(
    (a, b) => (ORDER[a.outcomeKey] ?? 9) - (ORDER[b.outcomeKey] ?? 9)
  );

  return (
    <div className="moneyline-cards">
      {sorted.map((row) => {
        const key = oddsKey(row);
        const flashDir = flash[key];
        const suspended = row.active === false || row.status === "suspended";
        const selected = !suspended && selectedOdds.has(key);
        const hasPrev =
          !suspended &&
          row.previousOdds !== null &&
          row.previousOdds !== undefined &&
          Number(row.previousOdds) !== Number(row.odds);
        return (
          <button
            type="button"
            className={`ml-card ${selected ? "selected" : ""} ${suspended ? "suspended" : ""}`}
            key={key}
            aria-pressed={selected}
            disabled={suspended}
            title={suspended ? "盘口暂停" : selected ? "取消选择" : "选择该赔率"}
            onClick={() => {
              if (!suspended) {
                onToggleOdds(row);
              }
            }}
          >
            <div className="ml-card-head">
              <span className="ml-tag">
                {outcomeLabel(marketType, row.outcomeKey, row.outcomeName)}
              </span>
            </div>
            <div className="ml-team">{teamLabel(row.outcomeKey, home, away, row.outcomeName)}</div>
            <div className="ml-odds">
              <OddsValue value={row.odds} direction={flashDir} suspended={suspended} />
            </div>
            {hasPrev ? (
              <div className={`ml-prev ${row.direction}`}>
                {formatOdds(row.previousOdds)} → {formatOdds(row.odds)}
              </div>
            ) : (
              <div className="ml-prev placeholder">&nbsp;</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
