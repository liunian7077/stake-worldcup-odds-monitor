import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readList(name, fallback) {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(projectRoot, value);
}

// DATABASE_URL is the new name used by the deploy scripts; DATABASE_PATH stays
// supported for backwards compatibility with older .env files.
const databasePathRaw =
  process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? "./data/stake-odds.sqlite";

// STAKE_ODDS_API_BASE_URL is the deploy-script name; STAKE_ODDS_API_BASE is the legacy name.
const stakeApiBase =
  process.env.STAKE_ODDS_API_BASE_URL ??
  process.env.STAKE_ODDS_API_BASE ??
  "https://odds-data.stake.com";

const requestTimeoutMs = readInt("REQUEST_TIMEOUT_MS", 15_000);
const scoreApiConfiguredIntervalMs = readInt("SCORE_API_INTERVAL_MS", 15_000);
const scoreApiMinIntervalMs = readInt("SCORE_API_MIN_INTERVAL_MS", 10_000);

export const config = {
  projectRoot,
  nodeEnv: process.env.NODE_ENV ?? "development",
  version: process.env.APP_VERSION ?? "0.2.0",
  host: process.env.HOST ?? "0.0.0.0",
  port: readInt("PORT", 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? "",

  stakeApiBase,
  stakeApiKey: process.env.STAKE_ODDS_API_KEY ?? "",
  stakeSport: process.env.STAKE_SPORT ?? "soccer",
  stakeCategory: process.env.STAKE_CATEGORY ?? "international",
  stakeTournament: process.env.STAKE_TOURNAMENT ?? "world-cup",
  worldCupFilterTerms: readList(
    "WORLD_CUP_FILTER_TERMS",
    "world cup,fifa world cup,world-cup,世界杯"
  ),

  scoreProvider: process.env.SCORE_PROVIDER ?? "worldcup26",
  scoreApiBase: process.env.SCORE_API_BASE_URL ?? "https://worldcup26.ir",
  scoreApiConfiguredIntervalMs,
  scoreApiMinIntervalMs,
  scoreApiIntervalMs: Math.max(scoreApiConfiguredIntervalMs, scoreApiMinIntervalMs),
  scoreApiTimeoutMs: readInt("SCORE_API_TIMEOUT_MS", Math.min(requestTimeoutMs, 8_000)),
  scoreApiBackoffMs: [10_000, 30_000, 60_000],

  databasePath: resolveProjectPath(databasePathRaw),

  // How often the scheduler ticks to look for due fixtures.
  schedulerTickMs: readInt("SCHEDULER_TICK_MS", 1_000),
  // How often the world-cup fixture list itself is refreshed (low frequency).
  fixtureListIntervalMs: readInt("FIXTURE_LIST_INTERVAL_MS", 60_000),

  // Per-status refresh cadence (milliseconds).
  intervalWatchedMs: readInt("INTERVAL_WATCHED_MS", 1_500),
  intervalLiveMs: readInt("INTERVAL_LIVE_MS", 2_000),
  intervalStartingSoonMs: readInt("INTERVAL_STARTING_SOON_MS", 8_000),
  intervalTodayMs: readInt("INTERVAL_TODAY_MS", 45_000),
  intervalFutureMs: readInt("INTERVAL_FUTURE_MS", 300_000),
  startingSoonWindowMs: readInt("STARTING_SOON_WINDOW_MS", 30 * 60_000),
  matchEndAfterMs: readInt("MATCH_END_AFTER_MS", 3 * 60 * 60_000),

  // Fetch queue.
  requestConcurrency: readInt("REQUEST_CONCURRENCY", 2),
  requestDelayMs: readInt("DEFAULT_REQUEST_DELAY_MS", readInt("REQUEST_DELAY_MS", 450)),
  requestTimeoutMs,
  retryBackoffMs: [5_000, 15_000, 30_000],
  maxFixtures: readInt("MAX_FIXTURES", readInt("MAX_FIXTURES_PER_POLL", 64)),

  // Enable the /api/mock-change dev endpoint. Defaults to on outside production.
  enableMockApi:
    (process.env.ENABLE_MOCK_API ?? (process.env.NODE_ENV === "production" ? "false" : "true")) ===
    "true",

  publicRateLimitMax: readInt("PUBLIC_RATE_LIMIT_MAX", 600),
  publicRateLimitWindow: process.env.PUBLIC_RATE_LIMIT_WINDOW ?? "1 minute"
};
