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
