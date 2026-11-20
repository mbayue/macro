import type { MeResponse, PlanResponse } from '../../../../../../src/api-types.ts';
import { journeyLabel, type JourneyRow } from '../../../../../../src/plan/journey-edit.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { countCodePoints } from '../../lib/describe.ts';

export type StudioBusy = 'planning' | 'approving' | null;
export type TargetMode = 'demo' | 'own';

const KIND_RANK = ['Page', 'Script', 'Stylesheet', 'Font', 'Image'] as const;

const fmtCount = (n: number): string => n.toLocaleString('en-US');

/** Returns true when a drafted plan parsed cleanly and passed every fixed Policy Gate rule. */
export function isApprovable(res: PlanResponse): boolean {
  return (
    !res.parseError &&
    res.plan !== null &&
    res.gate !== null &&
    res.gate.status === 'accepted' &&
    res.planText !== null
  );
}

/** Computes peak virtual users and total stage duration across all stages in a Test Plan. */
export function planSize(plan: TestPlan): { maxVus: number; totalSec: number } {
  return {
    maxVus: plan.stages.reduce((max, stage) => Math.max(max, stage.vus), 0),
    totalSec: plan.stages.reduce((sum, stage) => sum + stage.durationSec, 0),
  };
}

/** Validates trimmed Traffic Description code-point length against [min, max] bounds. */
export function validateTrafficLength(
  text: string,
  min: number,
  max: number,
): { count: number; inRange: boolean; problem: string } {
  const count = countCodePoints(text);
  const inRange = count >= min && count <= max;
  const problem =
    count === 0
      ? ''
      : count < min
        ? `Needs at least ${min} characters.`
        : count > max
          ? `${fmtCount(count - max)} over the limit.`
          : '';
  return { count, inRange, problem };
}

/** The inline error to show when the user submits this Traffic Description; empty when it can be drafted. */
export function trafficSubmitProblem(text: string, min: number, max: number): string {
  const { count, inRange, problem } = validateTrafficLength(text, min, max);
  if (inRange) return '';
  return count === 0 ? `Needs at least ${min} characters.` : problem;
}

/** Splits a route path into its trailing filename and shared directory prefix when applicable. */
export function pathFace(path: string): { name: string; dir: string | null } {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return { name: path, dir: null };
  const name = path.slice(slash + 1);
  if (name.length === 0) return { name: path, dir: null };
  return { name, dir: path.slice(0, slash + 1) };
}

/** Pluralizes a discovered route kind label for group headings. */
export function kindHeading(label: string, count: number): string {
  if (count === 1) return label;
  if (label === 'Page') return 'Pages';
  if (label === 'Stylesheet') return 'Stylesheets';
  return `${label}s`;
}

/** Buckets discovered journey rows by kind in canonical display order. */
export function kindGroups(rows: readonly JourneyRow[]): { label: string; rows: JourneyRow[] }[] {
  const buckets = new Map<string, JourneyRow[]>();
  for (const row of rows) {
    const label = journeyLabel(row);
    const list = buckets.get(label);
    if (list) list.push(row);
    else buckets.set(label, [row]);
  }
  return [...buckets.keys()]
    .sort((a, b) => {
      const ia = KIND_RANK.indexOf(a as (typeof KIND_RANK)[number]);
      const ib = KIND_RANK.indexOf(b as (typeof KIND_RANK)[number]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((label) => ({ label, rows: buckets.get(label) ?? [] }));
}

/** Returns the directory prefix shared by all rows, or null if empty or mixed. */
export function sharedDir(rows: readonly JourneyRow[]): string | null {
  if (rows.length === 0) return null;
  const dirs = rows.map((row) => pathFace(row.path).dir);
  const first = dirs[0];
  if (first == null || dirs.some((dir) => dir !== first)) return null;
  return first;
}

export type GateVerdictState =
  | 'pending'
  | 'parse_error'
  | 'no_plan'
  | 'rejected'
  | 'accepted'
  | 'missing_gate';

export type GateVerdictTone = 'ok' | 'bad' | 'neutral';

export interface GateStatusView {
  state: GateVerdictState;
  tone: GateVerdictTone;
  label: string;
  summary: string;
}

/** Resolves the Policy Gate verdict badge and plain-language summary for a draft response. */
export function resolveGateStatus(res: PlanResponse | null): GateStatusView {
  if (res === null) {
    return {
      state: 'pending',
      tone: 'neutral',
      label: 'Awaiting draft',
      summary: 'Draft a Test Plan to check it against fixed Policy Gate rules.',
    };
  }
  if (res.parseError) {
    return {
      state: 'parse_error',
      tone: 'bad',
      label: 'Not approvable',
      summary: 'The plan could not be read, so it cannot be approved.',
    };
  }
  if (res.plan === null) {
    return {
      state: 'no_plan',
      tone: 'neutral',
      label: 'No plan returned',
      summary: 'No plan was returned.',
    };
  }
  if (res.gate?.status === 'rejected') {
    return {
      state: 'rejected',
      tone: 'bad',
      label: 'Rejected by the policy gate',
      summary: 'This plan breaks fixed rules, so it cannot be approved. Change the description and draft again.',
    };
  }
  if (isApprovable(res)) {
    return {
      state: 'accepted',
      tone: 'ok',
      label: 'Passed the policy gate',
      summary: 'Fixed Policy Gate checks passed. Ready to approve and run.',
    };
  }
  return {
    state: 'missing_gate',
    tone: 'neutral',
    label: 'No policy result',
    summary: 'This plan has no policy result, so it cannot be approved.',
  };
}

/** Returns true when a location hash targets the inline own-site verification panel. */
export function isVerifyPanelHash(hash: string): boolean {
  const bare = hash.replace(/^#\/?/, '').split('?')[0]?.replace(/\/$/, '') ?? '';
  return bare === 'verify-panel';
}

export interface StudioTargetState {
  verifiedOrigin: { origin: string; host: string } | null;
  ownNeedsVerify: boolean;
  activeOrigin: string;
  pendingHost: string | null;
  showVerify: boolean;
}

/** Resolves active origin, pending host, and verification visibility for the Test Studio target picker. */
export function resolveTargetState({
  targetMode,
  me,
  webOrigin,
  openedVerify,
}: {
  targetMode: TargetMode;
  me: MeResponse | null;
  webOrigin: string;
  openedVerify: boolean;
}): StudioTargetState {
  const verifiedOrigin = me?.verifiedOrigin ?? null;
  const ownNeedsVerify = targetMode === 'own' && (me === null || verifiedOrigin === null);
  const activeOrigin = targetMode === 'own' && verifiedOrigin !== null ? verifiedOrigin.origin : webOrigin;
  const pendingHost = me?.pendingVerification?.host ?? null;
  const showVerify = me !== null && (openedVerify || ownNeedsVerify || pendingHost !== null);
  return {
    verifiedOrigin,
    ownNeedsVerify,
    activeOrigin,
    pendingHost,
    showVerify,
  };
}
