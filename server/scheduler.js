import { config } from "./config.js";
import { createFetchQueue } from "./fetchQueue.js";
import { isWorldCupFixture, normalizeFixtureResponse } from "./normalize.js";

const PHASE = {
  ENDED: "ended",
  LIVE: "live",
  STARTING_SOON: "starting_soon",
  TODAY: "today",
  FUTURE: "future"
};

// Priority for queue ordering: lower number = fetched first.
const PHASE_PRIORITY = {
  [PHASE.LIVE]: 2,
  [PHASE.STARTING_SOON]: 3,
  [PHASE.TODAY]: 4,
  [PHASE.FUTURE]: 5,
  [PHASE.ENDED]: 6
};

const ENDED_TOKENS = ["ended", "finished", "closed", "settled", "ft", "final", "result"];
const LIVE_TOKENS = ["live", "inplay", "in_play", "in-play", "started", "playing", "1h", "2h", "ht"];

function statusIncludes(status, tokens) {
  const text = String(status ?? "").toLowerCase();
  return tokens.some((token) => text.includes(token));
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function derivePhase(state, now) {
  const status = state.status;
  const start = Number(state.startTime);
  if (Number.isFinite(start) && start > 0) {
    const elapsed = now - start;
    if (elapsed >= config.matchEndAfterMs) {
      return PHASE.ENDED;
    }
    if (elapsed >= 0) {
      if (statusIncludes(status, ENDED_TOKENS)) {
        return PHASE.ENDED;
      }
      return PHASE.LIVE;
    }
    // Some provider rows can carry stale "ended" while their kickoff is still
    // in the future. For display and scheduling, kickoff time wins.
    if (start - now <= config.startingSoonWindowMs) {
      return PHASE.STARTING_SOON;
    }
    if (isSameDay(new Date(start), new Date(now))) {
      return PHASE.TODAY;
    }
    return PHASE.FUTURE;
  }

  if (statusIncludes(status, ENDED_TOKENS)) {
    return PHASE.ENDED;
  }
  if (statusIncludes(status, LIVE_TOKENS)) {
    return PHASE.LIVE;
  }
  return PHASE.TODAY;
}

function intervalForPhase(phase, isWatched) {
  if (phase === PHASE.ENDED) {
    return null; // stop fetching
  }
  if (isWatched) {
    return config.intervalWatchedMs;
  }
  switch (phase) {
    case PHASE.LIVE:
      return config.intervalLiveMs;
    case PHASE.STARTING_SOON:
      return config.intervalStartingSoonMs;
    case PHASE.TODAY:
      return config.intervalTodayMs;
    case PHASE.FUTURE:
      return config.intervalFutureMs;
    default:
      return config.intervalTodayMs;
  }
}

export function createScheduler({ db, stakeClient, scoreClient, sseHub, logger }) {
  const fixtures = new Map(); // slug -> state
  const queue = createFetchQueue({
    concurrency: config.requestConcurrency,
    minSpacingMs: config.requestDelayMs
  });

  let tickTimer = null;
  let lastListRefreshAt = 0;
  let listRefreshInFlight = false;
  let lastScoreRefreshAt = 0;
  let scoreRefreshInFlight = false;
  let scoreRetryCount = 0;
  let scoreBackoffUntil = 0;
  let watchedSlug = null;
  let roundChanges = 0;
  let totalChanges = 0;
  let lastSuccessAt = null;
  let lastScoreSuccessAt = null;

  function fixtureFromSnapshot(fixture) {
    return {
      slug: fixture.slug,
      stakeFixtureId: fixture.stakeFixtureId ?? fixture.id ?? null,
      name: fixture.rawName ?? fixture.name ?? fixture.slug,
      status: fixture.status ?? null,
      startTime: fixture.startTime ?? null,
      tournament: fixture.tournament ?? config.stakeTournament,
      category: fixture.category ?? config.stakeCategory,
      // Snapshot competitors are localized for the UI. Keep them out of the
      // scheduler seed so score matching can fall back to the raw English name.
      competitors: [],
      homeScore: fixture.homeScore ?? null,
      awayScore: fixture.awayScore ?? null,
      score: fixture.score ?? null
    };
  }

  function ensureStateFromDatabase(slug) {
    const snapshot = db.getSnapshot(0);
    const fixture = snapshot.fixtures.find((item) => item.slug === slug);
    if (!fixture || fixture.phase === PHASE.ENDED) {
      return null;
    }

    const state = ensureState(fixtureFromSnapshot(fixture));
    scheduleNext(state);
    return state;
  }

  function seedActiveFixturesFromDatabase() {
    const snapshot = db.getSnapshot(0);
    let seeded = 0;

    for (const fixture of snapshot.fixtures) {
      if (!fixture.slug || fixture.phase === PHASE.ENDED || fixtures.has(fixture.slug)) {
        continue;
      }
      const state = ensureState(fixtureFromSnapshot(fixture));
      scheduleNext(state);
      seeded += 1;
    }

    if (seeded > 0) {
      logger.info({ fixtures: seeded }, "scheduler seeded active fixtures from database");
    }
  }

  function ensureState(fixture) {
    let state = fixtures.get(fixture.slug);
    if (!state) {
      state = {
        matchId: fixture.slug,
        name: fixture.name ?? fixture.slug,
        status: fixture.status ?? null,
        startTime: fixture.startTime ?? fixture.date ?? null,
        raw: fixture,
        lastFetchAt: null,
        nextFetchAt: 0, // fetch ASAP on first sight
        fetchIntervalMs: null,
        isFetching: false,
        lastSuccessAt: null,
        lastError: null,
        lastDurationMs: null,
        retryCount: 0,
        priority: PHASE_PRIORITY[PHASE.FUTURE],
        phase: PHASE.FUTURE,
        isWatched: false
      };
      fixtures.set(fixture.slug, state);
    } else {
      state.name = fixture.name ?? state.name;
      state.status = fixture.status ?? state.status;
      state.startTime = fixture.startTime ?? fixture.date ?? state.startTime;
      state.raw = { ...state.raw, ...fixture };
    }
    return state;
  }

  function publishChanges(changes) {
    if (!changes.length) {
      return;
    }
    totalChanges += changes.length;
    sseHub.broadcast("odds-change", { changes });
  }

  function applyScoreToFixture(fixture) {
    if (!scoreClient) {
      return { fixture, changed: false, match: null };
    }
    return scoreClient.enrichFixture(fixture);
  }

  function publishScoreChanges(changes) {
    if (!changes.length) {
      return;
    }
    sseHub.broadcast("score-change", { changes });
  }

  function buildScoreChange(state, fixture) {
    const score = fixture.score ?? null;
    return {
      time: new Date().toISOString(),
      eventId: state.matchId,
      matchName: fixture.name ?? state.name,
      status: fixture.status ?? state.status,
      phase: state.phase,
      startTime: fixture.startTime ?? fixture.date ?? state.startTime,
      score,
      homeScore: score?.home ?? fixture.homeScore ?? null,
      awayScore: score?.away ?? fixture.awayScore ?? null,
      scoreUpdatedAt: score?.updatedAt ?? Date.now()
    };
  }

  function backfillScoresFromDatabase(processedSlugs) {
    if (!db.listFixturesForScoreBackfill) {
      return 0;
    }

    let matched = 0;
    let updated = 0;
    for (const fixture of db.listFixturesForScoreBackfill()) {
      if (!fixture?.slug || processedSlugs.has(fixture.slug)) {
        continue;
      }

      const enriched = applyScoreToFixture(fixture);
      if (!enriched.match) {
        continue;
      }

      matched += 1;
      if (enriched.changed) {
        db.upsertFixture(enriched.fixture);
        updated += 1;
      }
    }

    if (updated > 0) {
      logger.info({ matched, updated }, "score feed backfilled database fixtures");
    }
    return updated;
  }

  async function refreshScores() {
    const now = Date.now();
    if (
      !scoreClient ||
      config.scoreProvider === "off" ||
      scoreRefreshInFlight ||
      scoreBackoffUntil > now
    ) {
      return;
    }

    scoreRefreshInFlight = true;
    try {
      const result = await scoreClient.refresh();
      lastScoreRefreshAt = Date.now();
      if (!result.ok) {
        scoreRetryCount += 1;
        const wait =
          config.scoreApiBackoffMs[
            Math.min(scoreRetryCount - 1, config.scoreApiBackoffMs.length - 1)
          ];
        scoreBackoffUntil = Date.now() + wait;
        return;
      }

      scoreRetryCount = 0;
      scoreBackoffUntil = 0;
      lastScoreSuccessAt = result.at;
      const scoreChanges = [];
      const processedScoreSlugs = new Set();
      for (const state of fixtures.values()) {
        const enriched = applyScoreToFixture(state.raw);
        if (!enriched.match) {
          continue;
        }

        processedScoreSlugs.add(state.matchId);
        state.raw = enriched.fixture;
        state.status = enriched.fixture.status ?? state.status;
        state.startTime = enriched.fixture.startTime ?? enriched.fixture.date ?? state.startTime;
        state.phase = derivePhase(state, Date.now());
        state.priority = state.isWatched ? 1 : PHASE_PRIORITY[state.phase];
        db.upsertFixture(enriched.fixture);

        if (enriched.changed) {
          scoreChanges.push(buildScoreChange(state, enriched.fixture));
        }

        if (derivePhase(state, Date.now()) === PHASE.ENDED) {
          scheduleNext(state);
        }
      }

      const backfilled = backfillScoresFromDatabase(processedScoreSlugs);
      publishScoreChanges(scoreChanges);
      logger.info(
        { scores: result.games, changes: scoreChanges.length, backfilled },
        "score feed refreshed"
      );
    } catch (error) {
      logger.warn({ err: error }, "failed to apply score feed");
    } finally {
      scoreRefreshInFlight = false;
    }
  }

  async function refreshFixtureList() {
    if (listRefreshInFlight) {
      return;
    }
    listRefreshInFlight = true;
    try {
      const result = await queue.enqueue(() => stakeClient.getWorldCupFixtures(), {
        key: "__fixture_list__"
      });
      if (!result) {
        return;
      }
      const listed = (result.fixtures ?? [])
        .filter((fixture) => {
          const configuredWorldCup = config.stakeTournament.toLowerCase().includes("world-cup");
          return configuredWorldCup || isWorldCupFixture(fixture, config.worldCupFilterTerms);
        })
        .slice(0, config.maxFixtures);

      await refreshScores();

      for (const fixture of listed) {
        const enriched = applyScoreToFixture(fixture).fixture;
        db.upsertFixture(enriched);
        ensureState(enriched);
      }
      lastListRefreshAt = Date.now();
      logger.info({ fixtures: listed.length }, "fixture list refreshed");
    } catch (error) {
      logger.warn({ err: error }, "failed to refresh fixture list");
    } finally {
      listRefreshInFlight = false;
    }
  }

  async function fetchFixture(state) {
    if (state.isFetching) {
      return;
    }
    const enqueued = queue.enqueue(
      async () => {
        const startedAt = Date.now();
        state.isFetching = true;
        state.lastFetchAt = startedAt;
        try {
          const payload = await stakeClient.getFixture(state.matchId);
          const mergedPayload = {
            ...payload,
            fixture: {
              ...state.raw,
              ...(payload.fixture ?? {}),
              slug: state.matchId,
              competitors: state.raw?.competitors ?? payload.fixture?.competitors ?? []
            }
          };
          const { fixture, odds } = normalizeFixtureResponse(mergedPayload);
          if (fixture) {
            const enriched = applyScoreToFixture(fixture).fixture;
            state.raw = enriched;
            db.upsertFixture(enriched);
            state.status = enriched.status ?? state.status;
            state.startTime = enriched.startTime ?? enriched.date ?? state.startTime;
            const changes = db.applyOddsRows(odds, enriched);
            roundChanges = changes.length;
            publishChanges(changes);
          }
          state.lastSuccessAt = new Date().toISOString();
          state.lastError = null;
          state.retryCount = 0;
          state.lastDurationMs = Date.now() - startedAt;
          lastSuccessAt = state.lastSuccessAt;
        } catch (error) {
          state.lastError = { message: error.message, at: new Date().toISOString() };
          state.lastDurationMs = Date.now() - startedAt;
          state.retryCount += 1;
          logger.warn({ err: error, fixture: state.matchId }, "failed to refresh fixture odds");
        } finally {
          state.isFetching = false;
          scheduleNext(state);
        }
      },
      { key: state.matchId }
    );

    // enqueue returns null if this fixture is already queued/running — leave it.
    if (enqueued === null) {
      state.isFetching = false;
    }
  }

  function scheduleNext(state) {
    const now = Date.now();
    const phase = derivePhase(state, now);
    state.phase = phase;
    state.priority = state.isWatched ? 1 : PHASE_PRIORITY[phase];

    if (phase === PHASE.ENDED) {
      state.fetchIntervalMs = null;
      state.nextFetchAt = Number.POSITIVE_INFINITY;
      return;
    }

    // Error backoff overrides the normal cadence.
    if (state.lastError && state.retryCount > 0) {
      const backoff = config.retryBackoffMs;
      const wait = backoff[Math.min(state.retryCount - 1, backoff.length - 1)];
      state.fetchIntervalMs = intervalForPhase(phase, state.isWatched);
      state.nextFetchAt = now + wait;
      return;
    }

    const interval = intervalForPhase(phase, state.isWatched);
    state.fetchIntervalMs = interval;
    state.nextFetchAt = now + interval;
  }

  function tick() {
    const now = Date.now();

    if (now - lastListRefreshAt >= config.fixtureListIntervalMs) {
      refreshFixtureList().catch(() => {});
    }

    if (scoreBackoffUntil <= now && now - lastScoreRefreshAt >= config.scoreApiIntervalMs) {
      refreshScores().catch(() => {});
    }

    // Collect due fixtures, fetch in priority order.
    const due = [];
    for (const state of fixtures.values()) {
      const phase = derivePhase(state, now);
      state.phase = phase;
      state.priority = state.isWatched ? 1 : PHASE_PRIORITY[phase];
      if (phase === PHASE.ENDED || state.isFetching) {
        continue;
      }
      if (state.nextFetchAt <= now) {
        due.push(state);
      }
    }

    due.sort((a, b) => a.priority - b.priority || a.nextFetchAt - b.nextFetchAt);
    for (const state of due) {
      fetchFixture(state).catch(() => {});
    }
  }

  function setWatched(slug) {
    if (watchedSlug && watchedSlug !== slug) {
      const previous = fixtures.get(watchedSlug);
      if (previous) {
        previous.isWatched = false;
        // Non-live previous watched match drops back to its phase cadence.
        scheduleNext(previous);
      }
    }

    watchedSlug = slug || null;
    if (!slug) {
      return { ok: true, watched: null };
    }

    const state = fixtures.get(slug) ?? ensureStateFromDatabase(slug);
    if (!state) {
      return { ok: false, error: "unknown fixture" };
    }
    state.isWatched = true;
    state.priority = 1;
    state.nextFetchAt = 0; // fetch immediately on next tick
    return { ok: true, watched: slug };
  }

  function start() {
    if (tickTimer) {
      return;
    }
    seedActiveFixturesFromDatabase();
    refreshFixtureList().catch(() => {});
    tickTimer = setInterval(tick, config.schedulerTickMs);
  }

  function stop() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function countByFrequency() {
    let highFreq = 0;
    let lowFreq = 0;
    for (const state of fixtures.values()) {
      if (state.phase === PHASE.ENDED) {
        continue;
      }
      if (state.isWatched || state.phase === PHASE.LIVE) {
        highFreq += 1;
      } else {
        lowFreq += 1;
      }
    }
    return { highFreq, lowFreq };
  }

  function getStatus() {
    const { highFreq, lowFreq } = countByFrequency();
    return {
      tickMs: config.schedulerTickMs,
      queueLength: queue.size(),
      fetchingCount: queue.activeCount(),
      lastSuccessAt,
      roundChanges,
      totalChanges,
      highFreqCount: highFreq,
      lowFreqCount: lowFreq,
      watched: watchedSlug,
      score: scoreClient?.getStatus?.() ?? null,
      scoreIntervalMs: config.scoreApiIntervalMs,
      scoreConfiguredIntervalMs: config.scoreApiConfiguredIntervalMs,
      scoreMinIntervalMs: config.scoreApiMinIntervalMs,
      scoreTimeoutMs: config.scoreApiTimeoutMs,
      scoreRetryCount,
      scoreBackoffUntil: scoreBackoffUntil || null,
      lastScoreRefreshAt: lastScoreRefreshAt || null,
      lastScoreSuccessAt,
      fixtures: [...fixtures.values()].map((state) => ({
        matchId: state.matchId,
        name: state.name,
        status: state.status,
        phase: state.phase,
        startTime: state.startTime,
        isWatched: state.isWatched,
        isFetching: state.isFetching,
        fetchIntervalMs: state.fetchIntervalMs,
        nextFetchAt: Number.isFinite(state.nextFetchAt) ? state.nextFetchAt : null,
        lastFetchAt: state.lastFetchAt,
        lastSuccessAt: state.lastSuccessAt,
        lastDurationMs: state.lastDurationMs,
        lastError: state.lastError?.message ?? null
      }))
    };
  }

  // Used by the dev mock endpoint to publish a fabricated change consistently.
  function publishExternalChanges(changes) {
    roundChanges = changes.length;
    publishChanges(changes);
  }

  return {
    start,
    stop,
    tick,
    setWatched,
    getStatus,
    publishExternalChanges
  };
}
