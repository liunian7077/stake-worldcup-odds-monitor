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
    .replace(/['\u2019`]/g, "")
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

function normalizeWorldCup26Status(game) {
  if (isFinished(game.finished)) {
    return "finished";
  }

  const elapsed = String(game.time_elapsed ?? "").trim().toLowerCase();
  if (elapsed && !["notstarted", "not started", "null", "none"].includes(elapsed)) {
    return "live";
  }

  return "notstarted";
}

function normalizeWorldCup26Game(game) {
  const homeName = game.home_team_name_en ?? game.home_team_label ?? "";
  const awayName = game.away_team_name_en ?? game.away_team_label ?? "";
  const status = normalizeWorldCup26Status(game);

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

function isLiveScoreWorldCupStage(stage) {
  const text = [
    stage?.Ccd,
    stage?.Cnm,
    stage?.Csnm,
    stage?.CompN,
    stage?.CompUrlName,
    stage?.CompD
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return text.includes("world cup") || text.includes("world-cup") || text.includes("世界杯");
}

function normalizeLiveScoreStatus(event) {
  const eps = String(event?.Eps ?? "").trim().toLowerCase();
  const esid = Number(event?.Esid);

  if (eps.includes("'") || eps === "ht" || eps === "live" || esid === 3 || event?.Eact === 1) {
    return "live";
  }

  if (["ft", "aet", "ap", "pen", "after penalties"].includes(eps)) {
    return "finished";
  }

  return "notstarted";
}

function normalizeLiveScoreEvent(event, stage = event?.Stg ?? null) {
  const homeTeam = event?.T1?.[0] ?? {};
  const awayTeam = event?.T2?.[0] ?? {};
  const status = normalizeLiveScoreStatus(event);

  return {
    source: "livescore",
    sourceId: event?.Eid ?? null,
    sourceUpdatedAt: Date.now(),
    homeName: homeTeam.NmEn ?? homeTeam.Nm ?? "",
    awayName: awayTeam.NmEn ?? awayTeam.Nm ?? "",
    homeScore: parseScore(event?.Tr1),
    awayScore: parseScore(event?.Tr2),
    status,
    finished: status === "finished",
    timeElapsed: event?.Eps ?? null,
    group: stage?.Snm ?? null,
    matchday: stage?.Scd ?? null,
    localDate: event?.Esd ?? null
  };
}

function collectLiveScoreEvents(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (payload.Eid) {
    return [{ event: payload, stage: payload.Stg ?? null }];
  }

  const rows = [];
  for (const stage of payload.Stages ?? []) {
    if (!isLiveScoreWorldCupStage(stage)) {
      continue;
    }
    for (const event of stage.Events ?? []) {
      rows.push({ event, stage });
    }
  }
  return rows;
}

function dateLabelForLiveScore(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.liveScoreTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}${part("month")}${part("day")}`;
}

function providerNames() {
  return String(config.scoreProvider ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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

function mergeScoreMaps(base, override) {
  const merged = new Map(base);
  for (const [key, game] of override) {
    merged.set(key, game);
  }
  return merged;
}

export class WorldCupScoreClient {
  constructor({ logger }) {
    this.logger = logger;
    this.gamesByExactKey = new Map();
    this.worldCup26GamesByExactKey = new Map();
    this.liveScoreGamesByExactKey = new Map();
    this.lastSuccessAt = null;
    this.lastError = null;
    this.providers = providerNames();
    this.useLiveScore = this.providers.includes("livescore");
    this.useWorldCup26 =
      !this.providers.includes("off") &&
      (this.providers.includes("worldcup26") || (!this.useLiveScore && this.providers.length > 0));
  }

  async refreshWorldCup26() {
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
        const normalized = normalizeWorldCup26Game(game);
        const exactKey = scoreKey(normalized.homeName, normalized.awayName);
        if (exactKey !== "|") {
          next.set(exactKey, normalized);
        }
      }

      this.worldCup26GamesByExactKey = next;
      return { provider: "worldcup26", ok: true, games: next.size, at: new Date().toISOString() };
    } catch (error) {
      const summary = summarizeFetchError(error);
      this.logger.warn({ error: summary }, "failed to refresh world cup score feed");
      return { provider: "worldcup26", ok: false, error: summary };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchLiveScorePath(pathname) {
    const url = new URL(pathname, config.liveScoreApiBase);
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
        throw new Error(`LiveScore API ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  liveScorePaths() {
    const paths = [];
    const tz = config.liveScoreTimeZoneOffset;
    const locale = encodeURIComponent(config.liveScoreLocale);

    paths.push(`/v1/api/app/live/soccer/${tz}?locale=${locale}&MD=1`);
    for (let offset = -config.liveScoreDateWindowDays; offset <= config.liveScoreDateWindowDays; offset += 1) {
      paths.push(`/v1/api/app/date/soccer/${dateLabelForLiveScore(offset)}/${tz}?locale=${locale}&MD=1`);
    }

    for (const id of config.liveScoreEventIds) {
      paths.push(`/v1/api/app/scoreboard/soccer/${encodeURIComponent(id)}?locale=${locale}`);
    }

    return [...new Set(paths)];
  }

  async refreshLiveScore() {
    try {
      const next = new Map();
      for (const pathname of this.liveScorePaths()) {
        const payload = await this.fetchLiveScorePath(pathname);
        for (const { event, stage } of collectLiveScoreEvents(payload)) {
          const normalized = normalizeLiveScoreEvent(event, stage);
          const exactKey = scoreKey(normalized.homeName, normalized.awayName);
          if (exactKey !== "|") {
            next.set(exactKey, normalized);
          }
        }
      }

      this.liveScoreGamesByExactKey = next;
      return { provider: "livescore", ok: true, games: next.size, at: new Date().toISOString() };
    } catch (error) {
      const summary = summarizeFetchError(error);
      this.logger.warn({ error: summary }, "failed to refresh LiveScore score feed");
      return { provider: "livescore", ok: false, error: summary };
    }
  }

  async refresh() {
    const results = [];
    if (this.useWorldCup26) {
      results.push(await this.refreshWorldCup26());
    }
    if (this.useLiveScore) {
      results.push(await this.refreshLiveScore());
    }

    this.gamesByExactKey = config.liveScorePrefer
      ? mergeScoreMaps(this.worldCup26GamesByExactKey, this.liveScoreGamesByExactKey)
      : mergeScoreMaps(this.liveScoreGamesByExactKey, this.worldCup26GamesByExactKey);

    const ok = results.some((result) => result.ok) || this.gamesByExactKey.size > 0;
    if (ok) {
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return {
        ok: true,
        games: this.gamesByExactKey.size,
        at: this.lastSuccessAt,
        providers: results
      };
    }

    const error = results.find((result) => !result.ok)?.error ?? { message: "No score provider enabled" };
    this.lastError = { ...error, at: new Date().toISOString() };
    return { ok: false, error };
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
      liveScoreBaseUrl: config.liveScoreApiBase,
      cachedGames: this.gamesByExactKey.size,
      worldCup26CachedGames: this.worldCup26GamesByExactKey.size,
      liveScoreCachedGames: this.liveScoreGamesByExactKey.size,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError?.message ?? null,
      lastErrorAt: this.lastError?.at ?? null
    };
  }
}
