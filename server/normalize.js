// Market type taxonomy. The stable identity of an odds row across polls is
// eventId + marketType + outcomeName — NOT any provider marketId/outcomeId,
// because a market can be suspended and reopened with a fresh id.

export const MARKET_TYPES = {
  FULL_TIME_1X2: "full_time_1x2",
  FULL_TIME_CORRECT_SCORE: "full_time_correct_score",
  HALF_TIME_1X2: "half_time_1x2",
  HALF_TIME_CORRECT_SCORE: "half_time_correct_score"
};

export const MARKET_DISPLAY_NAMES = {
  [MARKET_TYPES.FULL_TIME_1X2]: "全场独赢",
  [MARKET_TYPES.FULL_TIME_CORRECT_SCORE]: "全场正确比分",
  [MARKET_TYPES.HALF_TIME_1X2]: "半场独赢",
  [MARKET_TYPES.HALF_TIME_CORRECT_SCORE]: "半场正确比分"
};

export const MARKET_TYPE_ORDER = [
  MARKET_TYPES.FULL_TIME_1X2,
  MARKET_TYPES.FULL_TIME_CORRECT_SCORE,
  MARKET_TYPES.HALF_TIME_1X2,
  MARKET_TYPES.HALF_TIME_CORRECT_SCORE
];

const PREFERRED_GROUPS = ["main", "threeway", "winner", "1st half", "first half"];

const ONE_X_TWO_TERMS = [
  "1x2",
  "moneyline",
  "money line",
  "match winner",
  "match result",
  "full time result",
  "result",
  "winner",
  "3way",
  "three way",
  "to win"
];

const HALF_TIME_TERMS = [
  "half time",
  "half-time",
  "halftime",
  "1st half",
  "first half",
  "ht ",
  "(ht)"
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase();
}

function isHalfTimeText(text) {
  return HALF_TIME_TERMS.some((term) => text.includes(term));
}

function isCorrectScoreText(text) {
  return text.includes("correct score");
}

function isOneXTwoText(text) {
  return ONE_X_TWO_TERMS.some((term) => text.includes(term));
}

// Classify a market into one of the 4 supported types, or null if unsupported.
// `contextText` lets the group/period name influence half-time detection when
// the market name alone does not carry the period.
function classifyMarket(market, contextText = "") {
  if (clean(market.specifiers) !== "") {
    return null; // skip handicap / over-under variants
  }

  const name = normalizeText(market.name);
  const haystack = `${name} ${contextText}`;
  const half = isHalfTimeText(haystack);

  if (isCorrectScoreText(name)) {
    return half ? MARKET_TYPES.HALF_TIME_CORRECT_SCORE : MARKET_TYPES.FULL_TIME_CORRECT_SCORE;
  }

  if (isOneXTwoText(name)) {
    return half ? MARKET_TYPES.HALF_TIME_1X2 : MARKET_TYPES.FULL_TIME_1X2;
  }

  return null;
}

function flattenMarketBuckets(markets) {
  const output = [];

  function visit(value) {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value.outcomes && value.name) {
      output.push(value);
    }
  }

  visit(markets);
  return output;
}

function groupPriority(groupName) {
  const index = PREFERRED_GROUPS.indexOf(normalizeText(groupName));
  return index === -1 ? 999 : index;
}

function parseScore(name) {
  const match = normalizeText(name).match(/(\d+)\s*[:\-x]\s*(\d+)/);
  if (!match) {
    return null;
  }
  return { home: Number(match[1]), away: Number(match[2]) };
}

function correctScoreOutcomeKey(outcome) {
  const n = normalizeText(outcome.name);
  if (n === "other" || n === "any other" || n.includes("other")) {
    return "score:other";
  }
  const score = parseScore(outcome.name);
  if (score) {
    return `score:${score.home}_${score.away}`;
  }
  return `score:${n.replace(/\s+/g, "_")}`;
}

function isDrawName(name) {
  const n = normalizeText(name);
  return n === "draw" || n === "x" || n === "tie" || n === "平局" || n === "平";
}

// Assign home/draw/away by reading outcome labels; falls back to positional
// order of the non-draw outcomes when labels are ambiguous.
function buildMoneylineKeys(outcomes) {
  const keys = new Array(outcomes.length);
  let nonDrawSeen = 0;
  for (let i = 0; i < outcomes.length; i += 1) {
    const name = normalizeText(outcomes[i].name);
    if (isDrawName(name)) {
      keys[i] = "draw";
      continue;
    }
    if (name === "1" || name === "home" || name.includes("home")) {
      keys[i] = "home";
      nonDrawSeen += 1;
      continue;
    }
    if (name === "2" || name === "away" || name.includes("away")) {
      keys[i] = "away";
      nonDrawSeen += 1;
      continue;
    }
    keys[i] = nonDrawSeen === 0 ? "home" : "away";
    nonDrawSeen += 1;
  }
  return keys;
}

function toStandardMarket({ fixture, group, market, marketType }) {
  const outcomes = market.outcomes ?? [];
  const isMoneyline =
    marketType === MARKET_TYPES.FULL_TIME_1X2 || marketType === MARKET_TYPES.HALF_TIME_1X2;
  const moneylineKeys = isMoneyline ? buildMoneylineKeys(outcomes) : null;

  return outcomes
    .map((outcome, index) => ({
      eventId: fixture.slug,
      fixtureSlug: fixture.slug,
      fixtureName: fixture.name,
      fixtureStatus: fixture.status,
      fixtureStartTime: fixture.startTime ?? fixture.date ?? null,
      marketType,
      marketName: clean(market.name),
      marketDisplayName: MARKET_DISPLAY_NAMES[marketType],
      groupName: clean(group.name),
      specifiers: clean(market.specifiers),
      outcomeKey: isMoneyline ? moneylineKeys[index] : correctScoreOutcomeKey(outcome),
      outcomeName: clean(outcome.name),
      odds: Number(outcome.odds),
      active: Boolean(outcome.active),
      sourceUpdatedAt: market.updatedAt ?? null
    }))
    .filter((row) => Number.isFinite(row.odds));
}

function pickBestMarket(candidates) {
  if (!candidates.length) {
    return null;
  }
  return [...candidates]
    .sort((a, b) => groupPriority(a.group.name) - groupPriority(b.group.name))
    .at(0);
}

export function normalizeFixtureResponse(payload) {
  const fixture = payload.fixture;
  if (!fixture?.slug) {
    return { fixture: null, odds: [] };
  }

  const candidates = {
    [MARKET_TYPES.FULL_TIME_1X2]: [],
    [MARKET_TYPES.FULL_TIME_CORRECT_SCORE]: [],
    [MARKET_TYPES.HALF_TIME_1X2]: [],
    [MARKET_TYPES.HALF_TIME_CORRECT_SCORE]: []
  };

  for (const group of payload.groups ?? []) {
    const contextText = normalizeText(group.name);
    for (const market of flattenMarketBuckets(group.markets)) {
      const marketType = classifyMarket(market, contextText);
      if (marketType) {
        candidates[marketType].push({ group, market });
      }
    }
  }

  const odds = [];
  for (const marketType of MARKET_TYPE_ORDER) {
    const best = pickBestMarket(candidates[marketType]);
    if (best) {
      odds.push(...toStandardMarket({ fixture, ...best, marketType }));
    }
  }

  return { fixture, odds };
}

export function isWorldCupFixture(fixture, terms) {
  const haystack = [fixture.slug, fixture.name, fixture.tournament, fixture.category, fixture.extId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!terms.length) {
    return true;
  }

  return terms.some((term) => haystack.includes(term.toLowerCase()));
}
