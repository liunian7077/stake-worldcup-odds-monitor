import React from "react";
import { Clock, Zap } from "lucide-react";
import { formatDateTime } from "../lib/format.js";
import { MARKET_TYPES, statusLabel } from "../lib/labels.js";
import { MoneylineCards } from "./MoneylineCards.jsx";
import { ScoreMatrix } from "./ScoreMatrix.jsx";

function deriveTeams(fixture) {
  const competitors = fixture.competitors;
  if (Array.isArray(competitors) && competitors.length >= 2) {
    const home = competitors[0]?.name ?? competitors[0];
    const away = competitors[1]?.name ?? competitors[1];
    if (home && away) {
      return [String(home), String(away)];
    }
  }
  const parts = String(fixture.name ?? "").split(/\s+-\s+|\s+vs\.?\s+/i);
  return [parts[0] ?? fixture.name, parts[1] ?? ""];
}

export function FixtureDetail({ fixture, flash }) {
  const [tab, setTab] = React.useState("full");
  const [showAllFull, setShowAllFull] = React.useState(false);
  const [showAllHalf, setShowAllHalf] = React.useState(false);

  if (!fixture) {
    return <section className="fixture-panel empty-state large">暂无赛事</section>;
  }

  const [home, away] = deriveTeams(fixture);
  const odds = fixture.odds ?? {};

  return (
    <section className="fixture-panel">
      <div className="fixture-heading">
        <div className="fixture-title">
          <h2>{fixture.name}</h2>
          <div className="fixture-sub">
            <span className="fixture-chip">
              <Clock size={14} aria-hidden="true" />
              {formatDateTime(fixture.startTime)}
            </span>
            <span className={`fixture-chip status-${fixture.phase ?? "future"}`}>
              {statusLabel(fixture.status, fixture.phase)}
            </span>
            {fixture.isWatched ? (
              <span className="fixture-chip watched">
                <Zap size={14} aria-hidden="true" /> 高频监控中
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="market-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`market-tab ${tab === "full" ? "active" : ""}`}
          onClick={() => setTab("full")}
        >
          全场
        </button>
        <button
          type="button"
          role="tab"
          className={`market-tab ${tab === "half" ? "active" : ""}`}
          onClick={() => setTab("half")}
        >
          半场
        </button>
      </div>

      {tab === "full" ? (
        <>
          <div className="market-block">
            <div className="block-title">全场独赢 / 1X2</div>
            <MoneylineCards
              marketType={MARKET_TYPES.FULL_TIME_1X2}
              rows={odds[MARKET_TYPES.FULL_TIME_1X2]}
              flash={flash}
              home={home}
              away={away}
            />
          </div>
          <div className="market-block">
            <div className="block-title">全场正确比分</div>
            <ScoreMatrix
              marketType={MARKET_TYPES.FULL_TIME_CORRECT_SCORE}
              rows={odds[MARKET_TYPES.FULL_TIME_CORRECT_SCORE]}
              flash={flash}
              showAll={showAllFull}
              onToggleShowAll={() => setShowAllFull((value) => !value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="market-block">
            <div className="block-title">半场独赢</div>
            <MoneylineCards
              marketType={MARKET_TYPES.HALF_TIME_1X2}
              rows={odds[MARKET_TYPES.HALF_TIME_1X2]}
              flash={flash}
              home={home}
              away={away}
            />
          </div>
          <div className="market-block">
            <div className="block-title">半场正确比分</div>
            <ScoreMatrix
              marketType={MARKET_TYPES.HALF_TIME_CORRECT_SCORE}
              rows={odds[MARKET_TYPES.HALF_TIME_CORRECT_SCORE]}
              flash={flash}
              showAll={showAllHalf}
              onToggleShowAll={() => setShowAllHalf((value) => !value)}
            />
          </div>
        </>
      )}
    </section>
  );
}
