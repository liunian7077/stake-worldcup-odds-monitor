import Fastify from "fastify";
import { config } from "./config.js";
import { createDatabase } from "./db.js";
import { logger } from "./logger.js";
import { buildApp } from "./routes.js";
import { createScheduler } from "./scheduler.js";
import { WorldCupScoreClient } from "./scoreClient.js";
import { createSseHub } from "./sseHub.js";
import { StakeOddsClient } from "./stakeClient.js";

const startedAt = Date.now();

if (!config.stakeApiKey) {
  logger.warn(
    "STAKE_ODDS_API_KEY 未配置：仅能访问无需鉴权的公开端点。请在服务器 .env 中设置后端 Key（前端不会收到 Key）。"
  );
}

const db = createDatabase();
const sseHub = createSseHub(logger);
const stakeClient = new StakeOddsClient({ logger });
const scoreClient = new WorldCupScoreClient({ logger });
const scheduler = createScheduler({ db, stakeClient, scoreClient, sseHub, logger });

const fastify = Fastify({
  loggerInstance: logger
});

await buildApp({ fastify, db, scheduler, sseHub, startedAt });

const shutdown = async () => {
  logger.info("shutting down");
  scheduler.stop();
  await fastify.close();
  db.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await fastify.listen({ host: config.host, port: config.port });
  scheduler.start();
} catch (error) {
  logger.error({ err: error }, "failed to start server");
  process.exit(1);
}
