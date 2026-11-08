/**
 * Rounding and display formatting for Stage_Metrics (requirement 7.4).
 * Pure functions; no I/O.
 */

/**
 * Round half away from zero to `decimals` places (default 0).
 *
 * A `Number(x.toPrecision(15))` pre-step removes binary floating error, so
 * values such as 1.005 (stored as 1.00499999999999989...) round as a reader
 * of the decimal text would expect. Non-finite input is returned unchanged.
 */
export function roundHalfAway(x: number, decimals: 0 | 1 | 2 | 3 = 0): number {
  if (!Number.isFinite(x)) return x;
  const factor = 10 ** decimals;
  const clean = Number(x.toPrecision(15));
  const scaled = Number((Math.abs(clean) * factor).toPrecision(15));
  const rounded = Math.floor(scaled + 0.5) / factor;
  if (rounded === 0) return 0;
  return clean < 0 ? -rounded : rounded;
}

/** Latency in whole milliseconds, e.g. `"123"`. */
export function fmtMs(x: number): string {
  return roundHalfAway(x, 0).toFixed(0);
}

/** Request_Error rate with exactly one decimal and a percent sign, e.g. `"12.3%"`. */
export function fmtPct(x: number): string {
  return `${roundHalfAway(x, 1).toFixed(1)}%`;
}

/** Requests per second with exactly one decimal, e.g. `"45.6"`. */
export function fmtRps(x: number): string {
  return roundHalfAway(x, 1).toFixed(1);
}

/** Integer count (request counts, 429 counts, VU counts), e.g. `"1200"`. */
export function fmtCount(x: number): string {
  return roundHalfAway(x, 0).toFixed(0);
}
