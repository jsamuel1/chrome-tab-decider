// How much each page is used, and which open pages earn a Chrome pin or a place in the Daily group.

const DAY = 864e5;
const MARGIN = 1.25; // a challenger must beat the holder of a slot by this much to take it

const decayed = (e, now, halfLifeDays) =>
  e ? e.score * 0.5 ** (Math.max(0, now - e.at) / (halfLifeDays * DAY)) : 0;

/** Count one more use of a page: the old score fades to `now`, then 1 is added. Returns the new usage. */
export function recordUse(usage, key, now, halfLifeDays = 7) {
  return { ...usage, [key]: { score: decayed(usage[key], now, halfLifeDays) + 1, at: now } };
}

/** Forget pages whose score has faded to almost nothing. */
export function pruneUsage(usage, now, halfLifeDays = 7, floor = 0.05) {
  return Object.fromEntries(Object.entries(usage).filter(([, e]) => decayed(e, now, halfLifeDays) >= floor));
}

/** Keep `slots` of the best pages. Holders stay unless a challenger beats the weakest by MARGIN. */
function fill(holders, challengers, slots, score) {
  const byScore = (a, b) => score(b) - score(a) || (a < b ? -1 : 1);
  const held = holders.slice().sort(byScore).slice(0, slots);
  const pool = challengers.slice().sort(byScore);
  while (held.length < slots && pool.length) held.push(pool.shift());
  held.sort(byScore);
  while (pool.length && held.length && score(pool[0]) > score(held[held.length - 1]) * MARGIN) {
    held[held.length - 1] = pool.shift();
    held.sort(byScore);
  }
  return held.sort(byScore);
}

/**
 * Which pages to pin, unpin and show in Daily. `openPages` are `{ key, tabId, pinned, userPinned, inDaily }`;
 * a page pinned by the user is never unpinned and uses up one of the pinned slots. `pin` and `unpin`
 * are changes to make; `daily` is every page that belongs in the Daily group.
 */
export function planPins(openPages, usage, { now, pinMax = 5, dailyMax = 8, ourPins = {}, cooldown = {}, halfLifeDays = 7 }) {
  const pages = new Map();
  for (const p of openPages) {
    const seen = pages.get(p.key);
    if (!seen || (p.pinned && !seen.pinned)) pages.set(p.key, { ...p, userPinned: !!p.userPinned || !!seen?.userPinned });
    else if (p.userPinned) seen.userPinned = true;
  }
  const score = (key) => decayed(usage[key], now, halfLifeDays);
  const all = [...pages.values()];
  const mine = (p) => p.pinned && !p.userPinned && !!ourPins[p.key];
  const used = (p) => score(p.key) > 0;

  const userPins = all.filter((p) => p.pinned && !mine(p)).length;
  const pins = fill(
    all.filter((p) => mine(p)).map((p) => p.key),
    all.filter((p) => !p.pinned && used(p) && !((cooldown[p.key] || 0) > now)).map((p) => p.key),
    Math.max(0, pinMax - userPins),
    score,
  );
  const pinSet = new Set(pins);

  const unpin = all.filter((p) => mine(p) && !pinSet.has(p.key)).map((p) => p.key);
  const pin = pins.filter((k) => !pages.get(k).pinned);

  const free = all.filter((p) => !p.pinned || unpin.includes(p.key));
  const daily = fill(
    free.filter((p) => p.inDaily && !pinSet.has(p.key)).map((p) => p.key),
    free.filter((p) => !p.inDaily && used(p) && !pinSet.has(p.key)).map((p) => p.key),
    dailyMax,
    score,
  ).filter((k) => score(k) > 0);

  return { pin, unpin, daily };
}

/** Stop pinning a page until `days` from now. Passed cooldowns that have ended are dropped. Returns the new cooldown. */
export function startCooldown(cooldown, key, now, days = 3) {
  const live = Object.fromEntries(Object.entries(cooldown).filter(([, until]) => until > now));
  return { ...live, [key]: now + days * DAY };
}
