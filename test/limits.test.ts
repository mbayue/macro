import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { DAILY_MAX, PLANNING_LIMIT, START_LIMIT, dailyCheck, nextUtcMidnight, rollingCheck, utcDayStart } from '../src/run/limits.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Independent reference: calendar math through Date, not floor-division.
function refDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function refNextMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

const arbNow = fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 });

describe('Property 19: Rolling and daily limits match a reference', () => {
  test('rollingCheck rejects exactly at the reference count and reports the oldest entry + window', () => {
    // Feature: macro, Property 19: Rolling and daily limits match a reference
    fc.assert(
      fc.property(
        arbNow,
        fc.constantFrom(PLANNING_LIMIT, START_LIMIT, { windowMs: HOUR, max: 1 }, { windowMs: 90_000, max: 3 }),
        fc.array(fc.integer({ min: -2 * HOUR - 5, max: 600_000 }), { maxLength: 40 }),
        fc.array(fc.constantFrom(0, -1, 1, -HOUR, -HOUR + 1, -HOUR - 1), { maxLength: 6 }),
        (now, limit, offsets, boundary) => {
          const timestamps = [...offsets, ...boundary].map((o) => now + o);
          const result = rollingCheck({ timestamps, now, windowMs: limit.windowMs, max: limit.max });

          const counted = timestamps.filter((t) => t > now - limit.windowMs && t <= now).sort((a, b) => a - b);
          if (counted.length < limit.max) {
            expect(result).toEqual({ allowed: true });
            return;
          }
          if (result.allowed) throw new Error('expected a rejection');
          // After the window slides to retryAt, the count falls below the maximum.
          const afterRetry = timestamps.filter((t) => t > result.retryAt - limit.windowMs && t <= now);
          expect(afterRetry.length).toBeLessThan(limit.max);
          // And it is the earliest such moment.
          const justBefore = timestamps.filter((t) => t > result.retryAt - 1 - limit.windowMs && t <= now);
          expect(justBefore.length).toBeGreaterThanOrEqual(limit.max);
          expect(result.retryAt).toBeGreaterThan(now);
          // With exactly `max` counted entries (the state the limiter maintains) it is oldest + window.
          if (counted.length === limit.max) expect(result.retryAt).toBe((counted[0] as number) + limit.windowMs);
          expect(result.retryAt).toBeGreaterThanOrEqual((counted[0] as number) + limit.windowMs);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('dailyCheck rejects exactly at the reference count and resets at the next UTC midnight', () => {
    // Feature: macro, Property 19: Rolling and daily limits match a reference
    fc.assert(
      fc.property(
        arbNow,
        fc.integer({ min: 1, max: 60 }),
        fc.array(fc.integer({ min: -3 * DAY, max: HOUR }), { maxLength: 90 }),
        (now, max, offsets) => {
          const startedAtMs = offsets.map((o) => now + o);
          const result = dailyCheck({ startedAtMs, now, max });

          const dayStart = refDayStart(now);
          const count = startedAtMs.filter((t) => t >= dayStart && t <= now).length;
          if (count < max) {
            expect(result).toEqual({ allowed: true });
          } else {
            if (result.allowed) throw new Error('expected a rejection');
            expect(result.resetAt).toBe(refNextMidnight(now));
            expect(result.resetAt).toBeGreaterThan(now);
            expect(result.resetAt % DAY).toBe(0);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('day helpers agree with calendar arithmetic', () => {
    // Feature: macro, Property 19: Rolling and daily limits match a reference
    fc.assert(
      fc.property(arbNow, (now) => {
        expect(utcDayStart(now)).toBe(refDayStart(now));
        expect(nextUtcMidnight(now)).toBe(refNextMidnight(now));
      }),
      { numRuns: 100 },
    );
  });
});

describe('limit constants and boundaries (9.4, 9.5, 9.6)', () => {
  test('configured limits', () => {
    expect(PLANNING_LIMIT).toEqual({ windowMs: HOUR, max: 10 });
    expect(START_LIMIT).toEqual({ windowMs: HOUR, max: 6 });
    expect(DAILY_MAX).toBe(50);
  });

  test('an entry exactly one window old has left the window; one at now still counts', () => {
    const now = 1_800_000_000_000;
    const old = Array.from({ length: 6 }, () => now - HOUR); // exactly on the edge: not counted
    expect(rollingCheck({ timestamps: old, now, ...START_LIMIT })).toEqual({ allowed: true });
    const inside = Array.from({ length: 6 }, () => now - HOUR + 1);
    expect(rollingCheck({ timestamps: inside, now, ...START_LIMIT })).toEqual({ allowed: false, retryAt: now + 1 });
    const atNow = Array.from({ length: 6 }, () => now);
    expect(rollingCheck({ timestamps: atNow, now, ...START_LIMIT })).toEqual({ allowed: false, retryAt: now + HOUR });
  });

  test('midnight rolls the daily count over', () => {
    const midnight = Date.UTC(2026, 6, 9);
    const before = Array.from({ length: 50 }, (_, i) => midnight - 1 - i);
    expect(dailyCheck({ startedAtMs: before, now: midnight + 5, max: DAILY_MAX })).toEqual({ allowed: true });
    const same = Array.from({ length: 50 }, (_, i) => midnight + i);
    expect(dailyCheck({ startedAtMs: same, now: midnight + 100, max: DAILY_MAX })).toEqual({
      allowed: false,
      resetAt: midnight + DAY,
    });
  });
});
