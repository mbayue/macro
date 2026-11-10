/**
 * Stage chart for the Capacity_Report (task 11.5, requirements 10.2, 10.6).
 *
 * Draws p95 latency per Stage as a line with points, a dashed horizontal line
 * at the p95 Stop_Threshold, and error-rate bars per Stage on a secondary
 * (right) axis with the error Stop_Threshold marked. Only stored metrics and
 * plan thresholds are drawn; no AI text ever reaches the chart. Values are
 * rounded the way the report tables round them (src/run/format.ts), so the
 * chart and the table agree.
 *
 * All geometry is computed in `buildChartGeometry` (pure, no DOM).
 */
import type { CapacityReport } from '../../../../../src/report/build.ts';
import { fmtCount, fmtMs, fmtPct, roundHalfAway } from '../../../../../src/run/format.ts';

// ------------------------------------------------------------ input ----

export interface ChartStage {
  /** 1-based Stage position (StageView.displayIndex). */
  position: number;
  vus: number;
  /** Rounded as displayed: whole ms. */
  p95Ms: number;
  /** Rounded as displayed: one decimal. */
  errorRatePct: number;
}

export interface ChartInput {
  stages: readonly ChartStage[];
  thresholds: { p95Ms: number; errorRatePct: number };
}

/** Stages with overall metrics, in report order. Empty when none has metrics. */
export function chartInputFromReport(report: CapacityReport): ChartInput {
  const stages: ChartStage[] = [];
  for (const s of report.stages) {
    if (s.overall === null) continue;
    stages.push({
      position: s.displayIndex,
      vus: s.vus,
      p95Ms: roundHalfAway(s.overall.raw.p95, 0),
      errorRatePct: roundHalfAway(s.overall.raw.errorRatePct, 1),
    });
  }
  return { stages, thresholds: { p95Ms: report.thresholds.p95Ms, errorRatePct: report.thresholds.errorRatePct } };
}

// --------------------------------------------------------- geometry ----

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 340;
const MARGIN = { top: 28, right: 64, bottom: 72, left: 64 } as const;

export interface Tick {
  y: number;
  label: string;
}

export interface ChartPoint {
  position: number;
  cx: number;
  cy: number;
}

export interface ChartBar {
  position: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartXLabel {
  x: number;
  stage: string;
  vus: string;
}

export interface ChartGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; width: number; height: number };
  /** Axis maxima after "nice" rounding. */
  leftMax: number;
  rightMax: number;
  leftTicks: Tick[];
  rightTicks: Tick[];
  points: ChartPoint[];
  /** SVG path data of the p95 line; empty string when there are no points. */
  linePath: string;
  bars: ChartBar[];
  p95LimitY: number;
  errorLimitY: number;
  xLabels: ChartXLabel[];
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * A "nice" axis: the smallest multiple of a 1, 2, 2.5 or 5 times a power of ten
 * that holds `max` in at most `maxTicks` intervals. Returns the axis maximum
 * and the tick values from 0 to that maximum. `max <= 0` gives a 0..1 axis.
 */
export function niceScale(max: number, maxTicks = 5): { max: number; step: number; ticks: number[] } {
  const top = Number.isFinite(max) && max > 0 ? max : 1;
  const rough = top / maxTicks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  let step = pow;
  for (const m of [1, 2, 2.5, 5, 10]) {
    step = m * pow;
    if (step >= rough) break;
  }
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Number((i * step).toPrecision(12)));
  return { max: ticks[ticks.length - 1] ?? step, step, ticks };
}

export function buildChartGeometry(input: ChartInput): ChartGeometry {
  const plot = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: CHART_WIDTH - MARGIN.left - MARGIN.right,
    height: CHART_HEIGHT - MARGIN.top - MARGIN.bottom,
  };
  const { stages, thresholds } = input;

  const maxP95 = Math.max(thresholds.p95Ms, ...stages.map((s) => s.p95Ms));
  const maxErr = Math.max(thresholds.errorRatePct, ...stages.map((s) => s.errorRatePct));
  const left = niceScale(maxP95 * 1.05);
  const right = niceScale(maxErr * 1.05);

  const yLeft = (v: number): number => r2(plot.y + plot.height - (v / left.max) * plot.height);
  const yRight = (v: number): number => r2(plot.y + plot.height - (v / right.max) * plot.height);

  const n = stages.length;
  const band = n > 0 ? plot.width / n : plot.width;
  const barWidth = r2(Math.min(band * 0.4, 56));
  const baseY = r2(plot.y + plot.height);

  const points: ChartPoint[] = [];
  const bars: ChartBar[] = [];
  const xLabels: ChartXLabel[] = [];
  stages.forEach((s, i) => {
    const cx = r2(plot.x + band * (i + 0.5));
    points.push({ position: s.position, cx, cy: yLeft(s.p95Ms) });
    const top = yRight(s.errorRatePct);
    bars.push({ position: s.position, x: r2(cx - barWidth / 2), y: top, width: barWidth, height: r2(baseY - top) });
    xLabels.push({ x: cx, stage: `Stage ${s.position}`, vus: `${fmtCount(s.vus)} VUs` });
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx} ${p.cy}`).join(' ');

  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    plot,
    leftMax: left.max,
    rightMax: right.max,
    leftTicks: left.ticks.map((v) => ({ y: yLeft(v), label: fmtMs(v) })),
    rightTicks: right.ticks.map((v) => ({ y: yRight(v), label: fmtPct(v) })),
    points,
    linePath,
    bars,
    p95LimitY: yLeft(thresholds.p95Ms),
    errorLimitY: yRight(thresholds.errorRatePct),
    xLabels,
  };
}

// ------------------------------------------------------ description ----

/** Plain-text summary used for the SVG `<desc>`. Built from stored metrics only. */
export function chartDescription(input: ChartInput): string {
  const { stages, thresholds } = input;
  if (stages.length === 0) return 'No Stage has metrics.';
  const parts = stages.map(
    (s) =>
      `Stage ${s.position} (${fmtCount(s.vus)} VUs): p95 latency ${fmtMs(s.p95Ms)} ms, error rate ${fmtPct(s.errorRatePct)}`,
  );
  return (
    `p95 latency line on the left axis in milliseconds, error rate bars on the right axis in percent. ` +
    `The p95 limit is ${fmtMs(thresholds.p95Ms)} ms and the error rate limit is ${fmtPct(thresholds.errorRatePct)}. ` +
    `${parts.join('. ')}.`
  );
}

