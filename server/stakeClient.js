import { config } from "./config.js";

// Thin read-only HTTP client for the Stake odds data API. Request spacing and
// concurrency are handled by the fetch queue, so this client is stateless.
export class StakeOddsClient {
  constructor({ logger }) {
    this.logger = logger;
    this.hasKey = Boolean(config.stakeApiKey);
  }

  async request(pathname) {
    const url = new URL(pathname, config.stakeApiBase);
    const headers = {
      accept: "application/json",
      "user-agent": "stake-worldcup-odds-monitor/0.2"
    };

    if (config.stakeApiKey) {
      headers["X-API-KEY"] = config.stakeApiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Stake API ${response.status} ${response.statusText}: ${body.slice(0, 180)}`
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getWorldCupFixtures() {
    const path = `/sports/${config.stakeSport}/${config.stakeCategory}/${config.stakeTournament}/fixtures`;
    return this.request(path);
  }

  async getFixture(slug) {
    return this.request(`/fixtures/${encodeURIComponent(slug)}`);
  }
}
