export function createSseHub(logger) {
  const clients = new Set();

  function send(client, event, payload) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  return {
    add(reply) {
      const client = reply.raw;
      const heartbeat = setInterval(() => {
        client.write(": keep-alive\n\n");
      }, 25_000);

      clients.add(client);
      client.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(client);
      });
      send(client, "connected", { connectedAt: new Date().toISOString() });
    },

    broadcast(event, payload) {
      for (const client of clients) {
        try {
          send(client, event, payload);
        } catch (error) {
          logger.warn({ err: error }, "failed to write SSE event");
          clients.delete(client);
        }
      }
    },

    size() {
      return clients.size;
    }
  };
}
