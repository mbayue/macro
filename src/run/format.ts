/**
 * Rounding and display formatting for Stage_Metrics (requirement 7.4).
 * Pure functions; no I/O.
 */

/** `toFixed` switches to exponent notation from 1e21; print such (integer-valued) doubles in full. */
function plainFixed(x: number, decimals: number): string {
  if (!Number.isFinite(x) || Math.abs(x) < 1e21) return x.toFixed(decimals);
  const whole = BigInt(x).toString();
  return decimals > 0 ? `${whole}.${'0'.repeat(decimals)}` : whole;
}

/**
 * Round half away from zero to `decimals` places (default 0).
 *
 * A `Number(x.toPrecision(15))` pre-step removes binary floating error, so
 * values such as 1.005 (stored as 1.00499999999999989...) round as a reader
 * of the decimal text would expect. Non-finite input is returned unchanged.
 */
export function roundHalfAway(x: number, decimals: 0 | 1 | 2 | 3 = 0): number {
  if (!Number.isFinite(x)) return x;
  // Every double at or above 2^52 is already an integer: nothing to round (and the
  // toPrecision pre-step below could overflow near Number.MAX_VALUE).
  if (Math.abs(x) >= 2 ** 52) return x;
  const factor = 10 ** decimals;
  const clean = Number(x.toPrecision(15));
  const scaled = Number((Math.abs(clean) * factor).toPrecision(15));
  const rounded = Math.floor(scaled + 0.5) / factor;
  if (rounded === 0) return 0;
  return clean < 0 ? -rounded : rounded;
}

/** Latency in whole milliseconds, e.g. `"123"`. */
export function fmtMs(x: number): string {
  return plainFixed(roundHalfAway(x, 0), 0);
}

/** Request_Error rate with exactly one decimal and a percent sign, e.g. `"12.3%"`. */
export function fmtPct(x: number): string {
  return `${plainFixed(roundHalfAway(x, 1), 1)}%`;
}

/** Requests per second with exactly one decimal, e.g. `"45.6"`. */
export function fmtRps(x: number): string {
  return plainFixed(roundHalfAway(x, 1), 1);
}

/** Integer count (request counts, 429 counts, VU counts), e.g. `"1200"`. */
export function fmtCount(x: number): string {
  return plainFixed(roundHalfAway(x, 0), 0);
}
