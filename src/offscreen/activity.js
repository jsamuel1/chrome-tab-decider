// Tracks engine requests in flight, so the service worker never unloads the engine mid-download
// (and still knows how long it has been idle after the worker itself restarts).

export function createActivity(now = Date.now) {
  let busy = 0;
  let last = now();
  return {
    async run(fn) {
      busy++;
      try {
        return await fn();
      } finally {
        busy--;
        last = now();
      }
    },
    idle: () => ({ busy, idleMs: busy ? 0 : now() - last }),
  };
}

// Requests that only look at the engine: they do not count as using it, so a status check on every
// tab switch does not keep an idle model loaded.
const PASSIVE = new Set(['engine.idle', 'decider.status']);

/** Run one request's handler, on the activity clock unless it only looks. */
export function handle(activity, type, fn) {
  return PASSIVE.has(type) ? Promise.resolve().then(fn) : activity.run(fn);
}

