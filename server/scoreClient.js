import { config } from "./config.js";

const TEAM_ALIASES = new Map([
  ["usa", "united states"],
  ["united states of america", "united states"],
  ["korea republic", "south korea"],
  ["republic of korea", "south korea"],
  ["czechia", "czech republic"],
  ["turkiye", "turkey"],
  ["cote d ivoire", "ivory coast"],
  ["cote divoire", "ivory coast"],
  ["congo dr", "democratic republic of the congo"],
  ["dr congo", "democratic republic of the congo"],
  ["d r congo", "democratic republic of the congo"],
  ["democratic republic congo", "democratic republic of the congo"],
  ["bosnia herzegovina", "bosnia and herzegovina"],
  ["curacao", "curacao"]
]);

function normalizeTeamName(value) {
  const text = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return TEAM_ALIASES.get(text) ?? text;
}

function scoreKey(home, away) {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}`;
}

function competitorName(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return (
      value.name ??
      value.title ??
      value.shortName ??
      value.displayName ??
      value.slug ??
      value.abbreviation ??
      ""
    );
  }

  return "";
}

function parseTeamsFromFixture(fixture) {
  const competitors = fixture?.competitors ?? [];
  const names = competitors.map(competitorName).filter(Boolean);
  if (names.length >= 2 && names.slice(0, 2).every((name) => normalizeTeamName(name))) {
    return [names[0], names[1]];
  }

  const parts = String(fixture?.name ?? "").split(/\s+-\s+/);
  return [parts[0] ?? "", parts[1] ?? ""];
}

function parseScore(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function isFinished(value) {
  return String(value ?? "").toLowerCase() === "true" || value === true;
}

function normalizeStatus(game) {
  if (isFinished(game.finished)) {
    return "finished";
  }

  const elapsed = String(game.time_elapsed ?? "").trim().toLowerCase();
  if (elapsed && !["notstarted", "not started", "null", "none"].includes(elapsed)) {
    return "live";
  }

  return "notstarted";
}

function normalizeGame(game) {
  const homeName = game.home_team_name_en ?? game.home_team_label ?? "";
  const awayName = game.away_team_name_en ?? game.away_team_label ?? "";
  const status = normalizeStatus(game);

  return {
    source: "worldcup26",
    sourceId: game.id ?? game._id ?? null,
    sourceUpdatedAt: Date.now(),
    homeName,
    awayName,
    homeScore: parseScore(game.home_score),
    awayScore: parseScore(game.away_score),
    status,
    finished: status === "finished",
    timeElapsed: game.time_elapsed ?? null,
    group: game.group ?? null,
    matchday: game.matchday ?? null,
    localDate: game.local_date ?? null
  };
}

function scoreChanged(previous, next) {
  return (
    Number(previous?.home) !== Number(next?.home) ||
    Number(previous?.away) !== Number(next?.away) ||
    String(previous?.status ?? "") !== String(next?.status ?? "")
  );
}

function summarizeFetchError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? error?.cause?.code ?? null,
    cause: error?.cause?.message ?? null
  };
}

export class WorldCupScoreClient {
  constructor({ logger }) {
    this.logger = logger;
    this.gamesByExactKey = new Map();
    this.lastSuccessAt = null;
    this.lastError = null;
  }

  async refresh() {
    const url = new URL("/get/games", config.scoreApiBase);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.scoreApiTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "stake-worldcup-odds-monitor/0.2"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Score API ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
      }

      const payload = await response.json();
      const games = Array.isArray(payload.games) ? payload.games : [];
      const next = new Map();

      for (const game of games) {
        const normalized = normalizeGame(game);
        const exactKey = scoreKey(normalized.homeName, normalized.awayName);
        if (exactKey !== "|") {
          next.set(exactKey, normalized);
        }
      }

      this.gamesByExactKey = next;
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true, games: next.size, at: this.lastSuccessAt };
    } catch (error) {
      const summary = summarizeFetchError(error);
      this.lastError = { ...summary, at: new Date().toISOString() };
      this.logger.warn({ error: summary }, "failed to refresh world cup score feed");
      return { ok: false, error: summary };
    } finally {
      clearTimeout(timeout);
    }
  }

  enrichFixture(fixture) {
    if (config.scoreProvider === "off") {
      return { fixture, changed: false, match: null };
    }

    const [home, away] = parseTeamsFromFixture(fixture);
    const exact = this.gamesByExactKey.get(scoreKey(home, away));
    const reverse = this.gamesByExactKey.get(scoreKey(away, home));
    const match = exact ?? reverse ?? null;

    if (!match) {
      return { fixture, changed: false, match: null };
    }

    const swapped = Boolean(reverse && !exact);
    const score = {
      home: swapped ? match.awayScore : match.homeScore,
      away: swapped ? match.homeScore : match.awayScore,
      status: match.status,
      timeElapsed: match.timeElapsed,
      source: match.source,
      sourceId: match.sourceId,
      updatedAt: match.sourceUpdatedAt
    };

    const previousScore = fixture.score ?? {
      home: fixture.homeScore,
      away: fixture.awayScore,
      status: fixture.status
    };
    const changed = scoreChanged(previousScore, score);
    const nextStatus = match.finished ? "finished" : match.status === "live" ? "live" : fixture.status;

    return {
      fixture: {
        ...fixture,
        status: nextStatus,
        homeScore: score.home,
        awayScore: score.away,
        score
      },
      changed,
      match
    };
  }

  getStatus() {
    return {
      provider: config.scoreProvider,
      baseUrl: config.scoreApiBase,
      cachedGames: this.gamesByExactKey.size,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError?.message ?? null,
      lastErrorAt: this.lastError?.at ?? null
    };
  }
}
