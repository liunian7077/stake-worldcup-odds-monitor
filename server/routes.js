import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { MARKET_DISPLAY_NAMES, MARKET_TYPE_ORDER } from "./normalize.js";

export async function buildApp({ fastify, db, scheduler, sseHub, startedAt }) {
  await fastify.register(cors, {
    origin: config.corsOrigin ? config.corsOrigin.split(",").map((s) => s.trim()) : true
  });

  await fastify.register(rateLimit, {
    max: config.publicRateLimitMax,
    timeWindow: config.publicRateLimitWindow
  });

  fastify.get("/api/health", async () => {
    const status = scheduler.getStatus();
    return {
      status: "ok",
      uptime: Math.round((Date.now() - startedAt) / 1000),
      version: config.version,
      database: { connected: true, path: config.databasePath },
      sseClients: sseHub.size(),
      scheduler: {
        queueLength: status.queueLength,
        fetchingCount: status.fetchingCount,
        lastSuccessAt: status.lastSuccessAt,
        lastScoreSuccessAt: status.lastScoreSuccessAt,
        score: status.score,
        highFreqCount: status.highFreqCount,
        lowFreqCount: status.lowFreqCount,
        roundChanges: status.roundChanges,
        totalChanges: status.totalChanges
      },
      queueLength: status.queueLength,
      fetchingCount: status.fetchingCount,
      lastSuccessAt: status.lastSuccessAt
    };
  });

  fastify.get("/api/snapshot", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const snapshot = db.getSnapshot();
    return {
      ...snapshot,
      totalChanges: db.getTotalChangeCount(),
      scheduler: scheduler.getStatus()
    };
  });

  fastify.get("/api/scheduler", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return scheduler.getStatus();
  });

  fastify.get("/api/changes", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const limit = Math.min(Number.parseInt(request.query.limit ?? "50", 10) || 50, 250);
    return { recentChanges: db.getRecentHistory(limit) };
  });

  // Frontend notifies the backend which fixture the user is viewing so the
  // scheduler can promote it to high-frequency monitoring.
  fastify.post("/api/watch", async (request, reply) => {
    const slug = request.body?.slug ?? null;
    const result = scheduler.setWatched(slug);
    if (!result.ok) {
      reply.code(404);
    }
    return result;
  });

  // Dev-only: fabricate an odds change to verify SSE / history / UI highlight.
  if (config.enableMockApi) {
    fastify.post("/api/mock-change", async (request, reply) => {
      const body = request.body ?? {};
      const snapshot = db.getSnapshot();
      const fixture =
        snapshot.fixtures.find((f) => f.slug === body.slug) ?? snapshot.fixtures[0];
      if (!fixture) {
        reply.code(404);
        return { ok: false, error: "没有可用比赛，无法模拟变化" };
      }

      const marketType =
        body.marketType && MARKET_TYPE_ORDER.includes(body.marketType)
          ? body.marketType
          : MARKET_TYPE_ORDER.find((type) => fixture.odds[type]?.length);
      const bucket = fixture.odds[marketType] ?? [];
      const target =
        bucket.find((o) => o.outcomeName === body.outcomeName) ?? bucket[0];

      if (!target) {
        reply.code(404);
        return { ok: false, error: "该比赛暂无可模拟的赔率盘口" };
      }

      const factor = Number(body.factor) || 1.05;
      const newOdds = Math.max(1.01, Math.round(target.odds * factor * 100) / 100);
      const row = {
        eventId: fixture.slug,
        fixtureSlug: fixture.slug,
        fixtureName: fixture.name,
        fixtureStartTime: fixture.startTime,
        marketType,
        marketName: target.marketName,
        marketDisplayName: target.marketDisplayName ?? MARKET_DISPLAY_NAMES[marketType],
        groupName: "mock",
        outcomeKey: target.outcomeKey,
        outcomeName: target.outcomeName,
        odds: newOdds,
        active: true,
        sourceUpdatedAt: Date.now()
      };

      const changes = db.applyOddsRows([row]);
      scheduler.publishExternalChanges(changes);
      return { ok: true, changes };
    });
  }

  const sseHandler = (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    sseHub.add(reply);
  };

  fastify.get("/api/events", sseHandler);
  fastify.get("/events", sseHandler);

  const distPath = path.join(config.projectRoot, "client", "dist");
  const indexPath = path.join(distPath, "index.html");

  if (fs.existsSync(indexPath)) {
    await fastify.register(fastifyStatic, {
      root: distPath,
      prefix: "/"
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/") || request.raw.url?.startsWith("/events")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.type("text/html").send(fs.readFileSync(indexPath, "utf8"));
    });
  }

  return fastify;
}
