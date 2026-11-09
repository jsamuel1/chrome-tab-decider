// Chrome logs "The on-device model is not available because the enterprise policy disables the feature"
// as an extension error on every availability() check, so once Chrome says the built-in model is
// unavailable TabSage stops asking: until Chrome updates (its user agent changes) or a week has passed.

export const RECHECK_MS = 7 * 864e5;

/** True when an earlier check in this Chrome found the built-in model unavailable, recently enough to trust. */
export function stillBlocked(rec, ua, now = Date.now()) {
  return !!rec && rec.ua === ua && now - rec.at >= 0 && now - rec.at < RECHECK_MS;
}

/** What to remember after a check: a record while it is unavailable, nothing once it is not. */
export const afterCheck = (availability, ua, now = Date.now()) => (availability === 'unavailable' ? { ua, at: now } : null);
