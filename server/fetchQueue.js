import { setTimeout as delay } from "node:timers/promises";

// Concurrency-limited task queue with a minimum spacing between dispatches.
// A failing task only rejects its own promise; it never blocks the queue.
// Tasks may carry a dedupe `key` so the same fixture is not enqueued twice.
export function createFetchQueue({ concurrency = 2, minSpacingMs = 0 } = {}) {
  const queue = [];
  const inFlightKeys = new Set();
  let active = 0;
  let pumping = false;
  let lastDispatchAt = 0;

  async function pump() {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (queue.length && active < concurrency) {
        const wait = Math.max(0, minSpacingMs - (Date.now() - lastDispatchAt));
        if (wait > 0) {
          await delay(wait);
        }
        const item = queue.shift();
        if (!item) {
          break;
        }
        lastDispatchAt = Date.now();
        active += 1;
        run(item);
      }
    } finally {
      pumping = false;
    }
  }

  function run(item) {
    Promise.resolve()
      .then(item.task)
      .then(
        (value) => item.resolve(value),
        (error) => item.reject(error)
      )
      .finally(() => {
        active -= 1;
        if (item.key) {
          inFlightKeys.delete(item.key);
        }
        pump();
      });
  }

  function enqueue(task, { key } = {}) {
    if (key && inFlightKeys.has(key)) {
      return null; // already queued or running
    }
    if (key) {
      inFlightKeys.add(key);
    }
    return new Promise((resolve, reject) => {
      queue.push({ task, key, resolve, reject });
      pump();
    });
  }

  return {
    enqueue,
    has: (key) => inFlightKeys.has(key),
    size: () => queue.length,
    activeCount: () => active
  };
}
