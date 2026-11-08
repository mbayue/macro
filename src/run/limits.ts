// Pure limit math (requirements 9.4, 9.5, 9.6). Callers derive the timestamp
// lists from the Run_Store, so a restart never resets a count.

export const PLANNING_LIMIT = { windowMs: 3_600_000, max: 10 } as const;
export const START_LIMIT = { windowMs: 3_600_000, max: 6 } as const;
export const DAILY_MAX = 50;

const DAY_MS = 86_400_000;

export type RollingResult = { allowed: true } | { allowed: false; retryAt: number };
export type DailyResult = { allowed: true } | { allowed: false; resetAt: number };

/**
 * Rolling window: counts timestamps `t` with `now - windowMs < t <= now`.
 * When the count has reached `max`, `retryAt` is the moment the oldest counted
 * entry leaves the window.
 */
export function rollingCheck(input: {
  timestamps: readonly number[];
  now: number;
  windowMs: number;
  max: number;
}): RollingResult {
  const { timestamps, now, windowMs, max } = input;
  const windowStart = now - windowMs;
  const counted = timestamps.filter((t) => t > windowStart && t <= now).sort((a, b) => a - b);
  if (counted.length < max) return { allowed: true };
  // The entry whose departure frees a slot: the (count - max + 1)th oldest.
  const blocking = counted[counted.length - max];
  if (blocking === undefined) return { allowed: true };
  return { allowed: false, retryAt: blocking + windowMs };
}

/** 00:00 UTC of the day containing `ms`. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** 00:00 UTC of the day after the one containing `ms`. */
export function nextUtcMidnight(ms: number): number {
  return utcDayStart(ms) + DAY_MS;
}

/**
 * Daily limit: counts `startedAtMs` entries from 00:00 UTC of `now`'s day up to
 * `now`. `resetAt` is the next 00:00 UTC.
 */
export function dailyCheck(input: {
  startedAtMs: readonly number[];
  now: number;
  max: number;
}): DailyResult {
  const { startedAtMs, now, max } = input;
  const dayStart = utcDayStart(now);
  const count = startedAtMs.filter((t) => t >= dayStart && t <= now).length;
  if (count < max) return { allowed: true };
  return { allowed: false, resetAt: nextUtcMidnight(now) };
}
