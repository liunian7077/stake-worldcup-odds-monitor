import { oddsKey } from "../lib/api.js";
import { EMPTY_MARKET_HINTS } from "../lib/labels.js";
import { OddsValue } from "./OddsValue.jsx";

function parseScoreKey(outcomeKey) {
  const match = /^score:(\d+)_(\d+)$/.exec(outcomeKey ?? "");
  if (!match) {
    return null;
  }
  return { home: Number(match[1]), away: Number(match[2]) };
}

function sortHomeWin(a, b) {
  return a.score.home - b.score.home || a.score.away - b.score.away;
}

function sortDraw(a, b) {
  return a.score.home - b.score.home;
}

function sortAwayWin(a, b) {
  return a.score.away - b.score.away || a.score.home - b.score.home;
}

function ScoreOption({ item, flash, selectedOdds, onToggleOdds }) {
  const key = oddsKey(item);
  const flashDir = flash[key];
  const selected = selectedOdds.has(key);
  const label = item.score ? `${item.score.home}:${item.score.away}` : item.outcomeName;

  return (
    <button
      type="button"
      className={`score-option ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      title={selected ? "取消选择" : "选择该比分"}
      onClick={() => onToggleOdds(item)}
    >
      <span className="cell-score">{label}</span>
      <span className="cell-odds">
        <OddsValue value={item.odds} direction={flashDir} />
      </span>
    </button>
  );
}

function ScoreGroup({ tone, title, items, flash, selectedOdds, onToggleOdds }) {
  return (
    <section className={`score-group ${tone}`}>
      <h4>{title}</h4>
      <div className="score-group-list">
        {items.map((item) => (
          <ScoreOption
            key={oddsKey(item)}
            item={item}
            flash={flash}
            selectedOdds={selectedOdds}
            onToggleOdds={onToggleOdds}
          />
        ))}
      </div>
    </section>
  );
}

export function ScoreMatrix({
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

  const scored = [];
  const others = [];
  for (const row of rows) {
    const parsed = parseScoreKey(row.outcomeKey);
    if (parsed) {
      scored.push({ ...row, score: parsed });
    } else {
      others.push(row);
    }
  }

  const homeWins = scored
    .filter((item) => item.score.home > item.score.away)
    .sort(sortHomeWin);
  const draws = scored.filter((item) => item.score.home === item.score.away).sort(sortDraw);
  const awayWins = scored
    .filter((item) => item.score.away > item.score.home)
    .sort(sortAwayWin);

  return (
    <div className="score-matrix-wrap">
      <div className="score-columns">
        <ScoreGroup
          tone="home"
          title={`${home || "主队"} 胜`}
          items={homeWins}
          flash={flash}
          selectedOdds={selectedOdds}
          onToggleOdds={onToggleOdds}
        />
        <ScoreGroup
          tone="draw"
          title="平局"
          items={draws}
          flash={flash}
          selectedOdds={selectedOdds}
          onToggleOdds={onToggleOdds}
        />
        <ScoreGroup
          tone="away"
          title={`${away || "客队"} 胜`}
          items={awayWins}
          flash={flash}
          selectedOdds={selectedOdds}
          onToggleOdds={onToggleOdds}
        />
      </div>

      {others.length > 0 ? (
        <div className="score-others">
          <div className="others-title">其他比分</div>
          <div className="others-grid">
            {others.map((row) => {
              return (
                <ScoreOption
                  key={oddsKey(row)}
                  item={row}
                  flash={flash}
                  selectedOdds={selectedOdds}
                  onToggleOdds={onToggleOdds}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
