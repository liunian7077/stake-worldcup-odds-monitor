import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import {
  localizeCompetitors,
  localizeFixtureName,
  localizeOutcomeName
} from "./localization.js";
import { MARKET_DISPLAY_NAMES, MARKET_TYPE_ORDER } from "./normalize.js";

const SCHEMA_VERSION = 2;

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function changePercent(oldOdds, newOdds) {
  if (!Number.isFinite(oldOdds) || oldOdds === 0) {
    return 0;
  }
  return Math.round(((newOdds - oldOdds) / oldOdds) * 10000) / 100;
}

function emptyOddsBuckets() {
  const buckets = {};
  for (const marketType of MARKET_TYPE_ORDER) {
    buckets[marketType] = [];
  }
  return buckets;
}

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

function deriveDisplayPhase(status, startTime) {
  const now = Date.now();
  const start = Number(startTime);

  if (Number.isFinite(start) && start > 0) {
    const elapsed = now - start;
    if (elapsed >= config.matchEndAfterMs) {
      return "ended";
    }
    if (elapsed >= 0) {
      if (statusIncludes(status, ENDED_TOKENS)) {
        return "ended";
      }
      return "live";
    }
    if (start - now <= config.startingSoonWindowMs) {
      return "starting_soon";
    }
    if (isSameDay(new Date(start), new Date(now))) {
      return "today";
    }
    return "future";
  }

  if (statusIncludes(status, ENDED_TOKENS)) {
    return "ended";
  }
  if (statusIncludes(status, LIVE_TOKENS)) {
    return "live";
  }
  return "today";
}

export function createDatabase() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new DatabaseSync(config.databasePath);

  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  // Schema migration: the odds taxonomy and history columns changed in v2.
  // Old rows used market_type 'moneyline'/'correct_score' and an outcome_key
  // identity, which are incompatible, so we drop and rebuild the odds tables.
  const userVersion = Number(db.prepare("PRAGMA user_version").get().user_version ?? 0);
  if (userVersion < SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS odds_history; DROP TABLE IF EXISTS current_odds;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS fixtures (
      slug TEXT PRIMARY KEY,
      stake_fixture_id TEXT,
      name TEXT NOT NULL,
      status TEXT,
      start_time INTEGER,
      tournament TEXT,
      category TEXT,
      competitors_json TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS current_odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      market_type TEXT NOT NULL,
      market_name TEXT NOT NULL,
      market_display_name TEXT NOT NULL,
      group_name TEXT,
      outcome_key TEXT NOT NULL,
      outcome_name TEXT NOT NULL,
      odds REAL NOT NULL,
      prev_odds REAL,
      active INTEGER NOT NULL DEFAULT 1,
      source_updated_at INTEGER,
      last_direction TEXT NOT NULL DEFAULT 'flat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES fixtures(slug) ON DELETE CASCADE,
      UNIQUE (event_id, market_type, outcome_name)
    );

    CREATE TABLE IF NOT EXISTS odds_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      match_name TEXT NOT NULL,
      market_type TEXT NOT NULL,
      market_name TEXT NOT NULL,
      outcome_name TEXT NOT NULL,
      old_odds REAL NOT NULL,
      new_odds REAL NOT NULL,
      direction TEXT NOT NULL,
      change_percent REAL NOT NULL DEFAULT 0,
      changed_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES fixtures(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_current_odds_event ON current_odds(event_id);
    CREATE INDEX IF NOT EXISTS idx_odds_history_changed_at ON odds_history(changed_at DESC);
  `);

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);

  const statements = {
    upsertFixture: db.prepare(`
      INSERT INTO fixtures (
        slug, stake_fixture_id, name, status, start_time, tournament, category,
        competitors_json, raw_json, created_at, updated_at, last_seen_at
      )
      VALUES (
        @slug, @stake_fixture_id, @name, @status, @start_time, @tournament, @category,
        @competitors_json, @raw_json, @timestamp, @timestamp, @timestamp
      )
      ON CONFLICT(slug) DO UPDATE SET
        stake_fixture_id = excluded.stake_fixture_id,
        name = excluded.name,
        status = excluded.status,
        start_time = excluded.start_time,
        tournament = excluded.tournament,
        category = excluded.category,
        competitors_json = excluded.competitors_json,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
    `),
    selectCurrentOdd: db.prepare(`
      SELECT * FROM current_odds
      WHERE event_id = @eventId AND market_type = @marketType AND outcome_name = @outcomeName
    `),
    insertCurrentOdd: db.prepare(`
      INSERT INTO current_odds (
        event_id, market_type, market_name, market_display_name, group_name,
        outcome_key, outcome_name, odds, prev_odds, active, source_updated_at,
        last_direction, created_at, updated_at
      )
      VALUES (
        @eventId, @marketType, @marketName, @marketDisplayName, @groupName,
        @outcomeKey, @outcomeName, @odds, NULL, @active, @sourceUpdatedAt,
        'flat', @timestamp, @timestamp
      )
    `),
    updateCurrentOdd: db.prepare(`
      UPDATE current_odds SET
        market_name = @marketName,
        market_display_name = @marketDisplayName,
        group_name = @groupName,
        outcome_key = @outcomeKey,
        odds = @odds,
        prev_odds = @prevOdds,
        active = @active,
        source_updated_at = @sourceUpdatedAt,
        last_direction = @direction,
        updated_at = @timestamp
      WHERE event_id = @eventId AND market_type = @marketType AND outcome_name = @outcomeName
    `),
    insertHistory: db.prepare(`
      INSERT INTO odds_history (
        event_id, match_name, market_type, market_name, outcome_name,
        old_odds, new_odds, direction, change_percent, changed_at
      )
      VALUES (
        @eventId, @matchName, @marketType, @marketName, @outcomeName,
        @oldOdds, @newOdds, @direction, @changePercent, @timestamp
      )
    `),
    listFixtures: db.prepare(`SELECT * FROM fixtures ORDER BY start_time ASC, name ASC`),
    listCurrentOdds: db.prepare(`
      SELECT * FROM current_odds ORDER BY event_id ASC, market_type ASC, outcome_key ASC
    `),
    recentHistory: db.prepare(`
      SELECT h.*, f.start_time
      FROM odds_history h
      LEFT JOIN fixtures f ON f.slug = h.event_id
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT @limit
    `),
    countHistory: db.prepare(`SELECT COUNT(*) AS total FROM odds_history`)
  };

  const upsertFixture = (fixture) => {
    const timestamp = nowIso();
    statements.upsertFixture.run({
      slug: fixture.slug,
      stake_fixture_id: fixture.stakeFixtureId ?? fixture.id ?? null,
      name: fixture.name ?? fixture.slug,
      status: fixture.status ?? null,
      start_time: fixture.startTime ?? fixture.date ?? null,
      tournament: fixture.tournament ?? config.stakeTournament,
      category: fixture.category ?? config.stakeCategory,
      competitors_json: toJson(fixture.competitors ?? []),
      raw_json: toJson(fixture),
      timestamp
    });
  };

  // Apply normalized odds rows for a fixture. The first time a given
  // (event_id, market_type, outcome_name) is seen it is stored as a baseline
  // and NOT counted as a change. Returns the list of OddsChange objects.
  const applyOddsRows = (rows) => {
    const changes = [];

    db.exec("BEGIN");
    try {
      for (const row of rows) {
        const timestamp = nowIso();
        const active = row.active ? 1 : 0;
        const key = {
          eventId: row.eventId,
          marketType: row.marketType,
          outcomeName: row.outcomeName
        };
        const existing = statements.selectCurrentOdd.get(key);

        if (!existing) {
          statements.insertCurrentOdd.run({
            ...key,
            marketName: row.marketName,
            marketDisplayName: row.marketDisplayName,
            groupName: row.groupName,
            outcomeKey: row.outcomeKey,
            odds: row.odds,
            active,
            sourceUpdatedAt: row.sourceUpdatedAt,
            timestamp
          });
          continue;
        }

        const changed = Number(existing.odds) !== Number(row.odds);
        const direction = changed
          ? row.odds > existing.odds
            ? "up"
            : "down"
          : existing.last_direction;

        if (changed) {
          const pct = changePercent(Number(existing.odds), Number(row.odds));
          statements.insertHistory.run({
            eventId: row.eventId,
            matchName: row.fixtureName,
            marketType: row.marketType,
            marketName: row.marketName,
            outcomeName: row.outcomeName,
            oldOdds: existing.odds,
            newOdds: row.odds,
            direction,
            changePercent: pct,
            timestamp
          });

          changes.push({
            time: timestamp,
            eventId: row.eventId,
            matchName: localizeFixtureName(row.fixtureName),
            fixtureStartTime: row.fixtureStartTime,
            marketType: row.marketType,
            marketDisplayName: row.marketDisplayName,
            outcomeKey: row.outcomeKey,
            outcomeName: localizeOutcomeName(row.outcomeName),
            oldOdds: existing.odds,
            newOdds: row.odds,
            direction,
            changePercent: pct
          });
        }

        statements.updateCurrentOdd.run({
          ...key,
          marketName: row.marketName,
          marketDisplayName: row.marketDisplayName,
          groupName: row.groupName,
          outcomeKey: row.outcomeKey,
          odds: row.odds,
          prevOdds: changed ? existing.odds : existing.prev_odds,
          active,
          sourceUpdatedAt: row.sourceUpdatedAt,
          direction,
          timestamp
        });
      }

      db.exec("COMMIT");
      return changes;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  function getRecentHistory(limit = 50) {
    return statements.recentHistory.all({ limit }).map((row) => ({
      id: row.id,
      time: row.changed_at,
      eventId: row.event_id,
      matchName: localizeFixtureName(row.match_name),
      fixtureStartTime: row.start_time ?? null,
      marketType: row.market_type,
      marketDisplayName: MARKET_DISPLAY_NAMES[row.market_type] ?? row.market_name,
      outcomeName: localizeOutcomeName(row.outcome_name),
      oldOdds: row.old_odds,
      newOdds: row.new_odds,
      direction: row.direction,
      changePercent: row.change_percent
    }));
  }

  function getTotalChangeCount() {
    return Number(statements.countHistory.get().total ?? 0);
  }

  function getSnapshot(limit = 50) {
    const fixtures = statements.listFixtures.all().map((fixture) => {
      const raw = fromJson(fixture.raw_json, {});
      const score = raw.score ?? null;
      const homeScore = score?.home ?? raw.homeScore ?? null;
      const awayScore = score?.away ?? raw.awayScore ?? null;

      return {
        slug: fixture.slug,
        eventId: fixture.slug,
        name: localizeFixtureName(fixture.name),
        rawName: fixture.name,
        status: fixture.status,
        phase: deriveDisplayPhase(fixture.status, fixture.start_time),
        startTime: fixture.start_time,
        tournament: fixture.tournament,
        category: fixture.category,
        competitors: localizeCompetitors(fromJson(fixture.competitors_json, [])),
        homeScore,
        awayScore,
        score: score
          ? {
              ...score,
              home: homeScore,
              away: awayScore
            }
          : null,
        scoreUpdatedAt: score?.updatedAt ?? null,
        scoreSource: score?.source ?? null,
        updatedAt: fixture.updated_at,
        odds: emptyOddsBuckets()
      };
    });

    const bySlug = new Map(fixtures.map((fixture) => [fixture.slug, fixture]));
    let oddsCount = 0;
    for (const row of statements.listCurrentOdds.all()) {
      const fixture = bySlug.get(row.event_id);
      if (!fixture || !fixture.odds[row.market_type]) {
        continue;
      }
      oddsCount += 1;
      fixture.odds[row.market_type].push({
        eventId: row.event_id,
        marketType: row.market_type,
        marketName: row.market_name,
        marketDisplayName: row.market_display_name,
        outcomeKey: row.outcome_key,
        outcomeName: localizeOutcomeName(row.outcome_name),
        odds: row.odds,
        previousOdds: row.prev_odds,
        active: Boolean(row.active),
        status: row.active ? "active" : "suspended",
        direction: row.last_direction,
        updatedAt: row.updated_at
      });
    }

    return {
      fixtures,
      oddsCount,
      recentChanges: getRecentHistory(limit)
    };
  }

  return {
    db,
    upsertFixture,
    applyOddsRows,
    getSnapshot,
    getRecentHistory,
    getTotalChangeCount,
    close: () => db.close()
  };
}
