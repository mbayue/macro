import { describe, expect, test } from 'bun:test';
import type { PlanResponse, VerifyStartResponse } from '../src/api-types.ts';
import type { Comparison } from '../src/report/compare.ts';
import type { RunsTableRow } from '../web/landing/src/app/components/compare/runs-table-view.ts';
import {
  planRunsListReducer,
  rerunActionReducer,
  type PlanRunsListState,
  type RerunActionState,
} from '../web/landing/src/app/components/run/Report.tsx';
import {
  hybridPromptReducer,
  type HybridPromptState,
} from '../web/landing/src/app/hooks/useHybridPrompt.ts';
import {
  recentRunsReducer,
  type RecentRunsState,
} from '../web/landing/src/app/hooks/useRecentRunsData.ts';
import {
  studioReviewReducer,
  type StudioReviewState,
} from '../web/landing/src/app/hooks/useStudioDraftSync.ts';
import {
  runComparisonReducer,
  type RunComparisonState,
} from '../web/landing/src/app/components/compare/useRunComparison.ts';
import {
  verifyFlowReducer,
  type VerifyFlowState,
} from '../web/landing/src/app/components/VerifyPanel.tsx';
import {
  studioRequestReducer,
  type StudioRequestState,
} from '../web/landing/src/app/pages/NewTest.tsx';
import {
  accountDeleteReducer,
  magicLinkReducer,
  type AccountDeleteState,
  type MagicLinkState,
} from '../web/landing/src/app/pages/SignIn.tsx';

const PENDING_SAMPLE: VerifyStartResponse = {
  token: 'tok-123',
  txtName: '_macro-verify.example.com',
  txtValue: 'tok-123',
  wellKnownUrl: 'https://example.com/.well-known/macro-site-verification',
  isCloudflare: false,
};

describe('Wave 1 explicit UI state machines', () => {
  describe('hybridPromptReducer', () => {
    test('streams chunks, completes, and ignores stray events when idle', () => {
      let state: HybridPromptState = { kind: 'idle' };
      // Stray chunk/succeed/fail/stop when idle are ignored.
      expect(hybridPromptReducer(state, { type: 'chunk', text: 'x' })).toEqual({ kind: 'idle' });
      expect(hybridPromptReducer(state, { type: 'fail', message: 'boom' })).toEqual({ kind: 'idle' });
      expect(hybridPromptReducer(state, { type: 'stop' })).toEqual({ kind: 'idle' });

      state = hybridPromptReducer(state, { type: 'start' });
      expect(state).toEqual({ kind: 'streaming', reply: null });

      state = hybridPromptReducer(state, { type: 'chunk', text: 'Hello' });
      expect(state).toEqual({ kind: 'streaming', reply: { text: 'Hello', origin: 'unknown' } });

      // Duplicate start while streaming does not wipe in-flight text.
      expect(hybridPromptReducer(state, { type: 'start' })).toBe(state);

      state = hybridPromptReducer(state, {
        type: 'succeed',
        reply: { text: 'Hello world', origin: 'on-device' },
      });
      expect(state).toEqual({
        kind: 'done',
        reply: { text: 'Hello world', origin: 'on-device' },
      });

      state = hybridPromptReducer(state, { type: 'clear' });
      expect(state).toEqual({ kind: 'idle' });
    });

    test('stop preserves partial reply without marking done; clear resets errors', () => {
      let state: HybridPromptState = { kind: 'idle' };
      state = hybridPromptReducer(state, { type: 'start' });
      state = hybridPromptReducer(state, { type: 'chunk', text: 'Partial' });
      state = hybridPromptReducer(state, { type: 'stop' });
      expect(state).toEqual({ kind: 'stopped', reply: { text: 'Partial', origin: 'unknown' } });

      state = hybridPromptReducer(state, { type: 'start' });
      state = hybridPromptReducer(state, { type: 'fail', message: 'Quota exceeded' });
      expect(state).toEqual({ kind: 'error', message: 'Quota exceeded' });

      // clear resets error cleanly (previously stale error remained).
      expect(hybridPromptReducer(state, { type: 'clear' })).toEqual({ kind: 'idle' });
    });
  });

  describe('runComparisonReducer', () => {
    test('allows succeed/fail only from loading and resets cleanly', () => {
      const fakeComparison = { samePlan: true } as unknown as Comparison;
      let state: RunComparisonState = { kind: 'idle' };
      expect(runComparisonReducer(state, { type: 'succeed', comparison: fakeComparison })).toEqual({
        kind: 'idle',
      });
      expect(runComparisonReducer(state, { type: 'fail', error: 'unreadable' })).toEqual({
        kind: 'idle',
      });

      state = runComparisonReducer(state, { type: 'load' });
      expect(state).toEqual({ kind: 'loading' });

      state = runComparisonReducer(state, { type: 'succeed', comparison: fakeComparison });
      expect(state).toEqual({ kind: 'ready', comparison: fakeComparison });

      state = runComparisonReducer(state, { type: 'load' });
      state = runComparisonReducer(state, { type: 'fail', error: 'unreadable' });
      expect(state).toEqual({ kind: 'error', error: 'unreadable' });

      expect(runComparisonReducer(state, { type: 'reset' })).toEqual({ kind: 'idle' });
    });
  });

  describe('verifyFlowReducer', () => {
    test('blocks illegal check/cancel when idle and resets showManual on cancel_ok', () => {
      let state: VerifyFlowState = { kind: 'idle', error: null };
      // Cannot check or cancel when there is no pending verification.
      expect(verifyFlowReducer(state, { type: 'check' })).toBe(state);
      expect(verifyFlowReducer(state, { type: 'cancel' })).toBe(state);

      state = verifyFlowReducer(state, { type: 'start' });
      expect(state).toEqual({ kind: 'starting' });
      // Late restore while starting is ignored.
      expect(verifyFlowReducer(state, { type: 'restore_pending', pending: PENDING_SAMPLE })).toBe(state);

      state = verifyFlowReducer(state, { type: 'start_ok', pending: PENDING_SAMPLE });
      expect(state).toEqual({ kind: 'pending', pending: PENDING_SAMPLE, showManual: false, error: null });

      state = verifyFlowReducer(state, { type: 'toggle_manual' });
      expect(state).toEqual({ kind: 'pending', pending: PENDING_SAMPLE, showManual: true, error: null });

      state = verifyFlowReducer(state, { type: 'check' });
      expect(state).toEqual({ kind: 'checking', pending: PENDING_SAMPLE, showManual: true });

      state = verifyFlowReducer(state, { type: 'check_err', message: 'Not found yet' });
      expect(state).toEqual({
        kind: 'pending',
        pending: PENDING_SAMPLE,
        showManual: true,
        error: 'Not found yet',
      });

      state = verifyFlowReducer(state, { type: 'cancel' });
      expect(state).toEqual({ kind: 'cancelling', pending: PENDING_SAMPLE, showManual: true });

      // Resetting clears pending AND showManual cleanly.
      state = verifyFlowReducer(state, { type: 'cancel_ok' });
      expect(state).toEqual({ kind: 'idle', error: null });
    });

    test('handles verified-origin clear lifecycle', () => {
      let state: VerifyFlowState = { kind: 'idle', error: null };
      state = verifyFlowReducer(state, { type: 'clear' });
      expect(state).toEqual({ kind: 'clearing' });
      state = verifyFlowReducer(state, { type: 'clear_err', message: 'Network error' });
      expect(state).toEqual({ kind: 'idle', error: 'Network error' });
      state = verifyFlowReducer(state, { type: 'clear' });
      state = verifyFlowReducer(state, { type: 'clear_ok' });
      expect(state).toEqual({ kind: 'idle', error: null });
    });
  });

  describe('magicLinkReducer & accountDeleteReducer', () => {
    test('enforces cooldown and prevents overlapping sends', () => {
      let state: MagicLinkState = { kind: 'idle', error: null };
      state = magicLinkReducer(state, { type: 'validation_error', message: 'Bad email' });
      expect(state).toEqual({ kind: 'idle', error: 'Bad email' });

      state = magicLinkReducer(state, { type: 'clear_error' });
      expect(state).toEqual({ kind: 'idle', error: null });

      state = magicLinkReducer(state, { type: 'send' });
      expect(state).toEqual({ kind: 'sending' });

      state = magicLinkReducer(state, { type: 'send_ok', cooldownSec: 2 });
      expect(state).toEqual({ kind: 'sent', waitSec: 2 });

      // Cannot resend during cooldown.
      expect(magicLinkReducer(state, { type: 'send' })).toBe(state);

      state = magicLinkReducer(state, { type: 'tick' });
      expect(state).toEqual({ kind: 'sent', waitSec: 1 });
      state = magicLinkReducer(state, { type: 'tick' });
      expect(state).toEqual({ kind: 'sent', waitSec: 0 });

      // Resend allowed once cooldown reaches 0.
      state = magicLinkReducer(state, { type: 'send' });
      expect(state).toEqual({ kind: 'sending' });
      state = magicLinkReducer(state, { type: 'send_err', message: 'Rate limited' });
      expect(state).toEqual({ kind: 'idle', error: 'Rate limited' });
    });

    test('accountDeleteReducer blocks overlapping deletes and surfaces errors', () => {
      let state: AccountDeleteState = { kind: 'idle', error: null };
      state = accountDeleteReducer(state, { type: 'start' });
      expect(state).toEqual({ kind: 'deleting' });
      expect(accountDeleteReducer(state, { type: 'start' })).toBe(state);

      state = accountDeleteReducer(state, { type: 'fail', message: 'Server error' });
      expect(state).toEqual({ kind: 'idle', error: 'Server error' });

      state = accountDeleteReducer(state, { type: 'start' });
      state = accountDeleteReducer(state, { type: 'succeed' });
      expect(state).toEqual({ kind: 'idle', error: null });
    });
  });

  describe('Wave 2: recentRunsReducer', () => {
    test('separates browser mode from account loading/ready/error states', () => {
      const row = { runId: 'r1' } as unknown as RunsTableRow;
      let state: RecentRunsState = { kind: 'account_loading', rows: [] };
      state = recentRunsReducer(state, { type: 'update_rows', next: [row] });
      state = recentRunsReducer(state, { type: 'account_ready' });
      expect(state).toEqual({ kind: 'account_ready', rows: [row] });

      state = recentRunsReducer(state, { type: 'account_error', error: 'Offline' });
      expect(state).toEqual({ kind: 'account_error', rows: [row], error: 'Offline' });

      state = recentRunsReducer(state, { type: 'enter_browser', rows: [row] });
      expect(state).toEqual({ kind: 'browser', rows: [row] });
    });
  });

  describe('Wave 2: planRunsListReducer & rerunActionReducer', () => {
    test('planRunsListReducer only accepts succeed/fail from loading', () => {
      let state: PlanRunsListState = { kind: 'loading' };
      state = planRunsListReducer(state, { type: 'succeed', rows: [] });
      expect(state).toEqual({ kind: 'ready', rows: [] });
      // Late failure after ready is ignored.
      expect(
        planRunsListReducer(state, { type: 'fail', error: { code: 'internal', message: 'err' } }),
      ).toBe(state);
    });

    test('rerunActionReducer prevents opening confirm while starting and clears error on start', () => {
      let state: RerunActionState = { kind: 'idle', error: null };
      state = rerunActionReducer(state, { type: 'open_confirm' });
      expect(state).toEqual({ kind: 'confirming' });
      state = rerunActionReducer(state, { type: 'close_confirm' });
      expect(state).toEqual({ kind: 'idle', error: null });

      state = rerunActionReducer(state, { type: 'open_confirm' });
      state = rerunActionReducer(state, { type: 'start' });
      expect(state).toEqual({ kind: 'starting' });
      expect(rerunActionReducer(state, { type: 'open_confirm' })).toBe(state);

      const err = { code: 'rate_limited', message: 'Slow down' } as const;
      state = rerunActionReducer(state, { type: 'fail', error: err });
      expect(state).toEqual({ kind: 'idle', error: err });
    });
  });

  describe('Wave 2: studioReviewReducer & studioRequestReducer', () => {
    test('studioReviewReducer prevents editing without a review and increments reviewSeq on apply', () => {
      const review = { plan: null, gate: null, modelCalls: [] } as unknown as PlanResponse;
      let state: StudioReviewState = { kind: 'composing', lastSubmitted: null, reviewSeq: 0 };
      // Cannot enter editing or keep_plan while composing.
      expect(studioReviewReducer(state, { type: 'start_edit' })).toBe(state);
      expect(studioReviewReducer(state, { type: 'keep_plan' })).toBe(state);

      state = studioReviewReducer(state, { type: 'begin_plan', value: '200 users', preserveReview: false });
      expect(state).toEqual({ kind: 'composing', lastSubmitted: '200 users', reviewSeq: 0 });

      state = studioReviewReducer(state, { type: 'apply_review', review });
      expect(state).toEqual({ kind: 'reviewing', review, lastSubmitted: '200 users', reviewSeq: 1 });

      state = studioReviewReducer(state, { type: 'start_edit' });
      expect(state).toEqual({ kind: 'editing', review, lastSubmitted: '200 users', reviewSeq: 1 });

      state = studioReviewReducer(state, { type: 'keep_plan' });
      expect(state).toEqual({ kind: 'reviewing', review, lastSubmitted: '200 users', reviewSeq: 1 });

      state = studioReviewReducer(state, { type: 'discard_plan' });
      expect(state).toEqual({ kind: 'composing', lastSubmitted: '200 users', reviewSeq: 1 });
    });

    test('studioRequestReducer blocks overlapping planning/approving transitions', () => {
      let state: StudioRequestState = { kind: 'idle', error: null };
      state = studioRequestReducer(state, { type: 'set_busy', busy: 'planning' });
      expect(state).toEqual({ kind: 'planning' });
      // Cannot jump directly from planning to approving.
      expect(studioRequestReducer(state, { type: 'set_busy', busy: 'approving' })).toBe(state);

      const err = { code: 'planning_failed', message: 'Model timed out' } as const;
      state = studioRequestReducer(state, { type: 'fail', error: err });
      expect(state).toEqual({ kind: 'idle', error: err });

      state = studioRequestReducer(state, { type: 'clear_error' });
      expect(state).toEqual({ kind: 'idle', error: null });
    });
  });
});
