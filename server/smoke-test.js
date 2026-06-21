import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MARKET_TYPES, normalizeFixtureResponse } from "./normalize.js";

const sample = {
  fixture: {
    slug: "sample-home-away",
    name: "Home - Away",
    status: "active",
    startTime: 1781204400000
  },
  groups: [
    {
      name: "main",
      markets: [
        [
          {
            name: "1x2",
            status: "active",
            specifiers: "",
            updatedAt: 1,
            outcomes: [
              { name: "Home", odds: 1.8, active: true },
              { name: "Draw", odds: 3.4, active: true },
              { name: "Away", odds: 4.8, active: true }
            ]
          }
        ],
        [
          {
            name: "Correct Score",
            status: "active",
            specifiers: "",
            updatedAt: 1,
            outcomes: [
              { name: "0:0", odds: 8.5, active: true },
              { name: "1:0", odds: 6.2, active: true },
              { name: "Other", odds: 2.1, active: true }
            ]
          }
        ]
      ]
    },
    {
      name: "1st Half",
      markets: [
        {
          name: "Half Time Result",
          status: "active",
          specifiers: "",
          updatedAt: 1,
          outcomes: [
            { name: "1", odds: 2.1, active: true },
            { name: "X", odds: 2.0, active: true },
            { name: "2", odds: 5.5, active: true }
          ]
        },
        {
          name: "Half Time Correct Score",
          status: "active",
          specifiers: "",
          updatedAt: 1,
          outcomes: [
            { name: "0:0", odds: 2.4, active: true },
            { name: "1:0", odds: 4.0, active: true }
          ]
        }
      ]
    }
  ]
};

const result = normalizeFixtureResponse(sample);
assert.equal(result.fixture.slug, "sample-home-away");

const byType = (type) => result.odds.filter((row) => row.marketType === type);

assert.equal(byType(MARKET_TYPES.FULL_TIME_1X2).length, 3);
assert.equal(byType(MARKET_TYPES.FULL_TIME_CORRECT_SCORE).length, 3);
assert.equal(byType(MARKET_TYPES.HALF_TIME_1X2).length, 3);
assert.equal(byType(MARKET_TYPES.HALF_TIME_CORRECT_SCORE).length, 2);

assert.deepEqual(
  byType(MARKET_TYPES.FULL_TIME_1X2).map((row) => row.outcomeKey),
  ["home", "draw", "away"]
);
assert.deepEqual(
  byType(MARKET_TYPES.HALF_TIME_1X2).map((row) => row.outcomeKey),
  ["home", "draw", "away"]
);

// Half-time markets must not be mixed into full-time buckets.
assert.ok(byType(MARKET_TYPES.FULL_TIME_1X2).every((row) => !row.marketName.toLowerCase().includes("half")));

// Correct score keys are parsed into score:H_A, with Other separated.
const ftScoreKeys = byType(MARKET_TYPES.FULL_TIME_CORRECT_SCORE).map((row) => row.outcomeKey);
assert.ok(ftScoreKeys.includes("score:0_0"));
assert.ok(ftScoreKeys.includes("score:other"));

const unsupportedPeriodPayload = {
  fixture: {
    slug: "sample-second-half",
    name: "Home - Away",
    status: "live",
    startTime: 1781204400000
  },
  groups: [
    {
      name: "1st2ndhalfmarkets",
      markets: [
        {
          name: "2nd Half - 1x2",
          status: "active",
          specifiers: "",
          outcomes: [
            { name: "Home", odds: 1.8, active: true },
            { name: "Draw", odds: 3.4, active: true },
            { name: "Away", odds: 4.8, active: true }
          ]
        },
        {
          name: "10 Minutes - 1x2 From 31 to 40",
          status: "active",
          specifiers: "",
          outcomes: [
            { name: "Home", odds: 2.1, active: true },
            { name: "Draw", odds: 2.0, active: true },
            { name: "Away", odds: 5.5, active: true }
          ]
        },
        {
          name: "Booking 1x2",
          status: "active",
          specifiers: "",
          outcomes: [
            { name: "Home", odds: 2.1, active: true },
            { name: "Draw", odds: 2.0, active: true },
            { name: "Away", odds: 5.5, active: true }
          ]
        }
      ]
    }
  ]
};
assert.equal(normalizeFixtureResponse(unsupportedPeriodPayload).odds.length, 0);

// Stable identity fields present on every row.
for (const row of result.odds) {
  assert.ok(row.eventId);
  assert.ok(row.marketType);
  assert.ok(row.outcomeName);
  assert.ok(row.marketDisplayName);
}

const tempDbPath = path.join(os.tmpdir(), `stake-odds-smoke-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = tempDbPath;

const { createDatabase } = await import("./db.js");
const testDb = createDatabase();
try {
  testDb.upsertFixture(result.fixture);
  testDb.applyOddsRows(result.odds, result.fixture);

  const withoutHomeAway = result.odds.filter((row) => {
    return (
      row.marketType !== MARKET_TYPES.FULL_TIME_1X2 ||
      row.outcomeKey === "draw"
    );
  });
  const suspensionChanges = testDb.applyOddsRows(withoutHomeAway, result.fixture);
  assert.equal(
    suspensionChanges.filter((change) => change.direction === "suspended").length,
    2
  );

  const [fixture] = testDb.getSnapshot().fixtures;
  const fullTime1x2 = fixture.odds[MARKET_TYPES.FULL_TIME_1X2];
  const byOutcomeKey = new Map(fullTime1x2.map((row) => [row.outcomeKey, row]));
  assert.equal(byOutcomeKey.get("home").active, false);
  assert.equal(byOutcomeKey.get("draw").active, true);
  assert.equal(byOutcomeKey.get("away").active, false);
} finally {
  testDb.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
  }
}

console.log("smoke test passed");
