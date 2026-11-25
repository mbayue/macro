import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountDraft, ConfigResponse, FirebaseWebConfig, MeResponse, PlanResponse } from '../src/api-types.ts';
import type { TestPlan } from '../src/types.ts';
import {
  isApprovable,
  kindGroups,
  kindHeading,
  pathFace,
  planSize,
  resolveGateStatus,
  resolveTargetState,
  sharedDir,
  trafficSubmitProblem,
  validateTrafficLength,
} from '../web/landing/src/app/components/studio/studio-view.ts';
import { TrafficComposer, type TrafficComposerProps } from '../web/landing/src/app/components/studio/TrafficComposer.tsx';
import { AppContext, type AppContextValue } from '../web/landing/src/app/context.tsx';
import { TargetPicker, type TargetPickerProps } from '../web/landing/src/app/components/studio/TargetPicker.tsx';
import { DemoBaselinePanel } from '../web/landing/src/app/components/studio/DemoBaselinePanel.tsx';
import { NewTest } from '../web/landing/src/app/pages/NewTest.tsx';
import {
  defaultFeaturedRuns,
  subscribeStudioFeed,
  useFirebaseStudioFeed,
} from '../web/landing/src/app/hooks/useFirebaseStudioFeed.ts';
import {
  buildAccountDraft,
  hydrateSignedInDraft,
  resolveInitialStudioDraft,
  syncDraftWithServer,
  useStudioDraftSync,
} from '../web/landing/src/app/hooks/useStudioDraftSync.ts';
import { NETWORK_ERROR } from '../web/landing/src/app/lib/api.ts';
import {
  loadReviewState,
  stashLocalDraft,
  stashReviewState,
  stashSignedOutDraft,
  takeLocalDraft,
} from '../web/landing/src/app/lib/draft-storage.ts';

function makePlan(overrides?: Partial<TestPlan>): TestPlan {
  return {
    name: 'Morning spike',
    target: 'https://yue.macro.my.id',
    stages: [
      { vus: 10, durationSec: 30 },
      { vus: 50, durationSec: 60 },
    ],
    journey: [{ route: 'store_home', probability: 100, thinkMs: 500 }],
    stopThresholds: { p95Ms: 1200, errorRatePct: 2 },
    ...overrides,
  };
}

function makePlanResponse(overrides?: Partial<PlanResponse>): PlanResponse {
  return {
    draftId: 'draft-1',
    plan: makePlan(),
    planText: '{"name":"Morning spike"}',
    planHash: 'hash-1',
    rationale: 'Stepped ramp',
    gate: { status: 'accepted' },
    parseError: null,
    modelCalls: [],
    routes: [],
    ...overrides,
  };
}

describe('isApprovable', () => {
  test('returns true only when parseError is null, plan and planText exist, and gate is accepted', () => {
    expect(isApprovable(makePlanResponse())).toBe(true);
    expect(
      isApprovable(
        makePlanResponse({
          parseError: { reason: 'Unexpected token' },
        }),
      ),
    ).toBe(false);
    expect(isApprovable(makePlanResponse({ plan: null }))).toBe(false);
    expect(isApprovable(makePlanResponse({ planText: null }))).toBe(false);
    expect(isApprovable(makePlanResponse({ gate: null }))).toBe(false);
    expect(
      isApprovable(
        makePlanResponse({
          gate: {
            status: 'rejected',
            violations: [{ rule: '4.4', path: 'stages[0].vus', message: 'too high' }],
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('planSize', () => {
  test('computes maxVus and totalSec across stages and handles empty stages', () => {
    expect(
      planSize(
        makePlan({
          stages: [
            { vus: 25, durationSec: 30 },
            { vus: 120, durationSec: 90 },
            { vus: 80, durationSec: 45 },
          ],
        }),
      ),
    ).toEqual({ maxVus: 120, totalSec: 165 });

    expect(planSize(makePlan({ stages: [] }))).toEqual({ maxVus: 0, totalSec: 0 });
  });
});

describe('validateTrafficLength', () => {
  test('trims whitespace, counts Unicode code points, and formats range errors', () => {
    expect(validateTrafficLength('   ', 10, 1000)).toEqual({
      count: 0,
      inRange: false,
      problem: '',
    });

    // Surrogate-pair emoji counts as 1 code point, not 2 UTF-16 code units.
    expect(validateTrafficLength('  🚀12345678  ', 10, 1000)).toEqual({
      count: 9,
      inRange: false,
      problem: 'Needs at least 10 characters.',
    });

    expect(validateTrafficLength('1234567890', 10, 1000)).toEqual({
      count: 10,
      inRange: true,
      problem: '',
    });

    expect(validateTrafficLength('a'.repeat(1000), 10, 1000)).toEqual({
      count: 1000,
      inRange: true,
      problem: '',
    });

    expect(validateTrafficLength('a'.repeat(2234), 10, 1000)).toEqual({
      count: 2234,
      inRange: false,
      problem: '1,234 over the limit.',
    });
  });
});

describe('journey path and kind grouping helpers', () => {
  test('pathFace splits filename and directory only when a non-leading file segment exists', () => {
    expect(pathFace('/')).toEqual({ name: '/', dir: null });
    expect(pathFace('/about')).toEqual({ name: '/about', dir: null });
    expect(pathFace('/assets/app.js')).toEqual({ name: 'app.js', dir: '/assets/' });
    expect(pathFace('/a/b/c/')).toEqual({ name: '/a/b/c/', dir: null });
  });

  test('kindHeading pluralizes labels cleanly', () => {
    expect(kindHeading('Page', 1)).toBe('Page');
    expect(kindHeading('Page', 3)).toBe('Pages');
    expect(kindHeading('Stylesheet', 1)).toBe('Stylesheet');
    expect(kindHeading('Stylesheet', 2)).toBe('Stylesheets');
    expect(kindHeading('Script', 0)).toBe('Scripts');
    expect(kindHeading('Font', 4)).toBe('Fonts');
    expect(kindHeading('Image', 2)).toBe('Images');
  });

  test('kindGroups buckets rows by label in fixed rank order', () => {
    const groups = kindGroups([
      { id: 'r5', path: '/img/hero.webp', kind: 'asset', defaultOn: true },
      { id: 'r4', path: '/fonts/mono.woff2', kind: 'asset', defaultOn: true },
      { id: 'r3', path: '/css/app.css', kind: 'style', defaultOn: true },
      { id: 'r2', path: '/js/main.js', kind: 'script', defaultOn: true },
      { id: 'r1', path: '/', kind: 'document', defaultOn: true },
      { id: 'r6', path: '/shop', kind: 'page', defaultOn: true },
    ]);

    expect(groups.map((g) => ({ label: g.label, ids: g.rows.map((r) => r.id) }))).toEqual([
      { label: 'Page', ids: ['r1', 'r6'] },
      { label: 'Script', ids: ['r2'] },
      { label: 'Stylesheet', ids: ['r3'] },
      { label: 'Font', ids: ['r4'] },
      { label: 'Image', ids: ['r5'] },
    ]);
  });

  test('sharedDir returns directory only when all rows share the exact same non-null dir', () => {
    expect(
      sharedDir([
        { id: 'r1', path: '/static/a.js', kind: 'script', defaultOn: true },
        { id: 'r2', path: '/static/b.js', kind: 'script', defaultOn: true },
      ]),
    ).toBe('/static/');

    expect(
      sharedDir([
        { id: 'r1', path: '/static/a.js', kind: 'script', defaultOn: true },
        { id: 'r2', path: '/vendor/b.js', kind: 'script', defaultOn: true },
      ]),
    ).toBeNull();

    expect(
      sharedDir([
        { id: 'r1', path: '/about', kind: 'page', defaultOn: true },
        { id: 'r2', path: '/static/a.js', kind: 'script', defaultOn: true },
      ]),
    ).toBeNull();

    expect(sharedDir([])).toBeNull();
  });
});

describe('resolveGateStatus', () => {
  test('maps draft/gate states to accessible status summaries', () => {
    expect(resolveGateStatus(null).state).toBe('pending');
    expect(resolveGateStatus(null).tone).toBe('neutral');

    const parseErr = resolveGateStatus(makePlanResponse({ parseError: { reason: 'Bad JSON' } }));
    expect(parseErr.state).toBe('parse_error');
    expect(parseErr.tone).toBe('bad');
    expect(parseErr.label).toBe('Not approvable');

    const noPlan = resolveGateStatus(makePlanResponse({ plan: null, planText: null }));
    expect(noPlan.state).toBe('no_plan');
    expect(noPlan.tone).toBe('neutral');

    const rejected = resolveGateStatus(
      makePlanResponse({
        gate: {
          status: 'rejected',
          violations: [{ rule: '4.2', path: 'target', message: 'not allowed' }],
        },
      }),
    );
    expect(rejected.state).toBe('rejected');
    expect(rejected.tone).toBe('bad');
    expect(rejected.label).toBe('Rejected by the policy gate');

    const accepted = resolveGateStatus(makePlanResponse());
    expect(accepted.state).toBe('accepted');
    expect(accepted.tone).toBe('ok');
    expect(accepted.label).toBe('Passed the policy gate');

    const missingGate = resolveGateStatus(makePlanResponse({ gate: null }));
    expect(missingGate.state).toBe('missing_gate');
    expect(missingGate.tone).toBe('neutral');
  });
});

describe('resolveTargetState', () => {
  test('derives active origin, verification requirement, and pending host', () => {
    expect(
      resolveTargetState({
        targetMode: 'demo',
        me: null,
        webOrigin: 'https://yue.macro.my.id',
      }),
    ).toEqual({
      verifiedOrigin: null,
      ownNeedsVerify: false,
      activeOrigin: 'https://yue.macro.my.id',
      pendingHost: null,
    });

    expect(
      resolveTargetState({
        targetMode: 'own',
        me: {
          user: { id: 'u1', email: 'dev@example.com', githubLogin: null },
          verifiedOrigin: null,
          pendingVerification: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        },
        webOrigin: 'https://yue.macro.my.id',
      }),
    ).toEqual({
      verifiedOrigin: null,
      ownNeedsVerify: true,
      activeOrigin: 'https://yue.macro.my.id',
      pendingHost: 'shop.example.com',
    });

    expect(
      resolveTargetState({
        targetMode: 'own',
        me: {
          user: { id: 'u1', email: 'dev@example.com', githubLogin: 'bayu' },
          verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
          pendingVerification: null,
        },
        webOrigin: 'https://yue.macro.my.id',
      }),
    ).toEqual({
      verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
      ownNeedsVerify: false,
      activeOrigin: 'https://shop.example.com',
      pendingHost: null,
    });
  });
});

describe('trafficSubmitProblem', () => {
  test('names the minimum even for an empty description, and is empty when in range', () => {
    expect(trafficSubmitProblem('', 10, 1000)).toBe('Needs at least 10 characters.');
    expect(trafficSubmitProblem('   ', 10, 1000)).toBe('Needs at least 10 characters.');
    expect(trafficSubmitProblem('short', 10, 1000)).toBe('Needs at least 10 characters.');
    expect(trafficSubmitProblem('a'.repeat(1002), 10, 1000)).toBe('2 over the limit.');
    expect(trafficSubmitProblem('1234567890', 10, 1000)).toBe('');
  });
});

describe('TrafficComposer draft button', () => {
  function render(overrides: Partial<TrafficComposerProps>): string {
    const props: TrafficComposerProps = {
      text: '',
      min: 10,
      max: 1000,
      count: 0,
      inRange: false,
      problem: '',
      busy: null,
      hasReview: false,
      editing: false,
      showRetry: false,
      ownNeedsVerify: false,
      examples: [],
      assistantRoutes: [],
      planError: null,
      textareaRef: { current: null },
      onTextChange: () => {},
      onBlurSync: () => {},
      onSubmitDraft: () => {},
      onKeepPlan: () => {},
      onRetry: () => {},
      onApplyAssistant: () => {},
      ...overrides,
    };
    const app = {
      config: { examples: [], catalog: [], trafficEventMin: 10, trafficEventMax: 1000 },
      me: null,
      refreshMe: async () => {},
      navigate: () => {},
      announce: () => {},
    } as unknown as AppContextValue;
    return renderToStaticMarkup(createElement(AppContext.Provider, { value: app }, createElement(TrafficComposer, props)));
  }
  const draftButton = (html: string): string => html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';

  test('stays enabled with an empty or too-short description and while own site needs verifying', () => {
    expect(draftButton(render({}))).not.toContain(' disabled="');
    expect(draftButton(render({ text: 'short', count: 5, problem: 'Needs at least 10 characters.' }))).not.toContain(' disabled="');
    expect(draftButton(render({ ownNeedsVerify: true }))).not.toContain(' disabled="');
  });

  test('is disabled only while a request is in flight', () => {
    expect(draftButton(render({ busy: 'planning' }))).toContain(' disabled="');
    expect(draftButton(render({ busy: 'approving' }))).toContain(' disabled="');
  });
});
describe('TargetPicker verified own site', () => {
  function render(overrides: Partial<TargetPickerProps>): string {
    const props: TargetPickerProps = {
      targetMode: 'own',
      webOrigin: 'https://yue.macro.my.id',
      me: {
        user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
        verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        pendingVerification: null,
      },
      verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
      disabled: false,
      onChooseTarget: () => {},
      ...overrides,
    };
    return renderToStaticMarkup(createElement(TargetPicker, props));
  }

  test('links to #/domains via Manage domain when verified and never renders inline VerifyPanel', () => {
    const html = render({});
    expect(html).toContain('href="#/domains"');
    expect(html).toContain('Manage domain');
    expect(html).not.toContain('id="verify-panel"');
  });

  test('links to #/domains when unverified without inline VerifyPanel or spring-green primary fill', () => {
    const html = render({
      me: {
        user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
        verifiedOrigin: null,
        pendingVerification: null,
      },
      verifiedOrigin: null,
    });
    expect(html).toContain('href="#/domains"');
    expect(html).toContain('Verify a domain');
    expect(html).not.toContain('id="verify-panel"');
    expect(html).not.toContain('bg-primary');
  });
});

describe('DemoBaselinePanel', () => {
  test('renders nothing when demo trends are missing, unavailable, or empty', () => {
    expect(renderToStaticMarkup(createElement(DemoBaselinePanel, { demoTrends: null }))).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(DemoBaselinePanel, {
          demoTrends: { available: false, windowDays: 30, routes: [] },
        }),
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(DemoBaselinePanel, {
          demoTrends: { available: true, windowDays: 30, routes: [] },
        }),
      ),
    ).toBe('');
  });

  test('renders up to 6 routes with tabular monospace latencies, status badges, and zero style= props', () => {
    const html = renderToStaticMarkup(
      createElement(DemoBaselinePanel, {
        demoTrends: {
          available: true,
          windowDays: 30,
          routes: [
            { route: 'store_home', avgMs: 42.4, maxMs: 90, errors: 0, errorRatePct: 0, requests: 100, status: 'steady' },
            { route: 'catalog_list', avgMs: 185.7, maxMs: 400, errors: 1, errorRatePct: 1.25, requests: 100, status: 'spiky' },
            { route: 'checkout_post', avgMs: null, maxMs: 0, errors: 6, errorRatePct: 12.34, requests: 50, status: 'degraded' },
            { route: 'r4', avgMs: 10, maxMs: 20, errors: 0, errorRatePct: 0, requests: 10, status: 'steady' },
            { route: 'r5', avgMs: 10, maxMs: 20, errors: 0, errorRatePct: 0, requests: 10, status: 'steady' },
            { route: 'r6', avgMs: 10, maxMs: 20, errors: 0, errorRatePct: 0, requests: 10, status: 'steady' },
            { route: 'r7_overflow', avgMs: 99, maxMs: 120, errors: 0, errorRatePct: 0, requests: 10, status: 'steady' },
          ],
        },
      }),
    );
    expect(html).toContain('30-day demo baseline');
    expect(html).toContain('Observed across public demo runs over the last 30 days.');
    expect(html).toContain('store_home');
    expect(html).toContain('42 ms');
    expect(html).toContain('0.0% err');
    expect(html).toContain('steady');
    expect(html).toContain('186 ms');
    expect(html).toContain('1.3% err');
    expect(html).toContain('spiky');
    expect(html).toContain('n/a');
    expect(html).toContain('12.3% err');
    expect(html).toContain('degraded');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
    expect(html).not.toContain('r7_overflow');
    expect(html).not.toContain('style=');
  });
});

describe('useFirebaseStudioFeed', () => {
  const firebaseCfg: FirebaseWebConfig = {
    apiKey: 'key',
    appId: 'app',
    projectId: 'macro-test',
  };

  test('defaultFeaturedRuns builds the sample report card only when sampleRunId is set', () => {
    expect(defaultFeaturedRuns(null)).toEqual([]);
    expect(defaultFeaturedRuns(undefined)).toEqual([]);
    expect(defaultFeaturedRuns('run_abc')).toEqual([
      {
        runId: 'run_abc',
        label: 'View sample report',
        summary: 'Inspect a completed public demo run with stages, charts, and capacity verdict.',
      },
    ]);
  });

  test('subscribeStudioFeed delivers templates, featured runs, and announcements, and suppresses updates after cleanup', async () => {
    const receivedExamples: unknown[] = [];
    const receivedRuns: unknown[] = [];
    const receivedAnnouncements: unknown[] = [];
    let unsubCalled = 0;
    let pushAnnouncement: ((next: { message: string; tone: 'info' | 'warn' } | null) => void) | null = null;

    let resolveTemplates!: (v: readonly { label: string; text: string }[]) => void;
    let resolveRuns!: (v: readonly { runId: string; label: string; summary: string }[]) => void;

    const cleanup = subscribeStudioFeed(
      {
        firebase: firebaseCfg,
        fallbackExamples: [{ label: 'Fallback', text: 'Fallback traffic description.' }],
        fallbackRuns: defaultFeaturedRuns('sample_1'),
      },
      {
        onExamples: (e) => receivedExamples.push(e),
        onFeaturedRuns: (r) => receivedRuns.push(r),
        onAnnouncement: (a) => receivedAnnouncements.push(a),
      },
      {
        fetchScenarioTemplates: () => new Promise((res) => { resolveTemplates = res; }),
        fetchFeaturedRuns: () => new Promise((res) => { resolveRuns = res; }),
        subscribeActiveAnnouncement: (_cfg, onUpdate) => {
          pushAnnouncement = onUpdate;
          return () => {
            unsubCalled += 1;
          };
        },
      },
    );

    pushAnnouncement!({ message: 'Live maintenance notice.', tone: 'warn' });
    resolveTemplates([{ label: 'Flash sale', text: 'Ramp to 200 shoppers over 3 minutes.' }]);
    resolveRuns([{ runId: 'run_featured_1', label: '200 VU peak', summary: 'Passed safely.' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(receivedExamples).toEqual([[{ label: 'Flash sale', text: 'Ramp to 200 shoppers over 3 minutes.' }]]);
    expect(receivedRuns).toEqual([[{ runId: 'run_featured_1', label: '200 VU peak', summary: 'Passed safely.' }]]);
    expect(receivedAnnouncements).toEqual([{ message: 'Live maintenance notice.', tone: 'warn' }]);

    cleanup();
    expect(unsubCalled).toBe(1);

    // Late snapshot after cleanup must not fire callbacks.
    pushAnnouncement!({ message: 'Late notice.', tone: 'info' });
    expect(receivedAnnouncements).toHaveLength(1);
  });

  test('subscribeStudioFeed ignores delayed template/run resolutions that arrive after cleanup', async () => {
    let called = 0;
    let resolveTemplates!: (v: readonly { label: string; text: string }[]) => void;
    let resolveRuns!: (v: readonly { runId: string; label: string; summary: string }[]) => void;

    const cleanup = subscribeStudioFeed(
      {
        firebase: firebaseCfg,
        fallbackExamples: [],
        fallbackRuns: [],
      },
      {
        onExamples: () => { called += 1; },
        onFeaturedRuns: () => { called += 1; },
        onAnnouncement: () => { called += 1; },
      },
      {
        fetchScenarioTemplates: () => new Promise((res) => { resolveTemplates = res; }),
        fetchFeaturedRuns: () => new Promise((res) => { resolveRuns = res; }),
        subscribeActiveAnnouncement: () => () => {},
      },
    );

    cleanup();
    resolveTemplates([{ label: 'Late', text: 'Should be ignored after cleanup.' }]);
    resolveRuns([{ runId: 'run_late_1', label: 'Late run', summary: 'Should be ignored.' }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(called).toBe(0);
  });

  test('useFirebaseStudioFeed initializes fallback examples and featuredRuns on initial render', () => {
    let snapshot: ReturnType<typeof useFirebaseStudioFeed> | null = null;
    function Probe() {
      snapshot = useFirebaseStudioFeed({
        firebase: null,
        examples: [{ label: 'Checkout', text: '100 shoppers over 2 minutes.' }],
        sampleRunId: 'run_sample_1',
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(snapshot!.examples).toEqual([{ label: 'Checkout', text: '100 shoppers over 2 minutes.' }]);
    expect(snapshot!.featuredRuns).toEqual(defaultFeaturedRuns('run_sample_1'));
    expect(snapshot!.announcement).toBeNull();
  });
});

describe('useStudioDraftSync', () => {
  function memoryStorage() {
    const store = new Map<string, string>();
    return {
      store,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  }

  test('resolveInitialStudioDraft restores matching stashed review or signed-out draft', () => {
    const storage = memoryStorage();
    stashSignedOutDraft('Signed-out traffic description', storage);

    expect(resolveInitialStudioDraft(null, storage)).toEqual({
      text: 'Signed-out traffic description',
      lastSubmitted: null,
      review: null,
      editing: false,
      targetMode: 'demo',
    });

    const planRes = makePlanResponse();
    stashReviewState(
      {
        ownerUserId: 'user_1',
        review: planRes,
        lastSubmitted: 'Submitted own-site traffic',
        editing: true,
        targetMode: 'own',
      },
      storage,
    );

    expect(resolveInitialStudioDraft('user_1', storage)).toEqual({
      text: 'Submitted own-site traffic',
      lastSubmitted: 'Submitted own-site traffic',
      review: planRes,
      editing: true,
      targetMode: 'own',
    });

    // Different user ignores user_1's stashed review and falls back to signed-out draft.
    expect(resolveInitialStudioDraft('user_2', storage)).toEqual({
      text: 'Signed-out traffic description',
      lastSubmitted: null,
      review: null,
      editing: false,
      targetMode: 'demo',
    });
  });

  test('buildAccountDraft includes verified targetOrigin only in own mode', () => {
    expect(
      buildAccountDraft({
        trafficEvent: 'Ramp 50 VUs',
        targetMode: 'demo',
        verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        lastEditedAt: 1000,
      }),
    ).toEqual({
      trafficEvent: 'Ramp 50 VUs',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: 1000,
    });

    expect(
      buildAccountDraft({
        trafficEvent: 'Ramp 50 VUs',
        targetMode: 'own',
        verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        lastEditedAt: 2000,
      }),
    ).toEqual({
      trafficEvent: 'Ramp 50 VUs',
      targetMode: 'own',
      targetOrigin: 'https://shop.example.com',
      lastEditedAt: 2000,
    });
  });

  test('syncDraftWithServer updates timestamp on success and resolves 409 conflicts with announcement', async () => {
    const applied: AccountDraft[] = [];
    const timestamps: number[] = [];
    const announcements: string[] = [];

    const draft: AccountDraft = {
      trafficEvent: 'Local draft',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: 100,
    };

    const okResult = await syncDraftWithServer(draft, {
      putDraft: async (d) => ({ ok: true, data: { ...d, lastEditedAt: 250 } }),
      applyDraft: (d) => applied.push(d),
      setLastEditedAt: (ts) => timestamps.push(ts),
      announce: (m) => announcements.push(m),
    });

    expect(okResult).toEqual({ ...draft, lastEditedAt: 250 });
    expect(timestamps).toEqual([250]);
    expect(applied).toEqual([]);
    expect(announcements).toEqual([]);

    const newerServerDraft: AccountDraft = {
      trafficEvent: 'Newer server draft',
      targetMode: 'own',
      targetOrigin: 'https://shop.example.com',
      lastEditedAt: 999,
    };

    const conflictResult = await syncDraftWithServer(draft, {
      putDraft: async () => ({ ok: true, data: newerServerDraft, conflict: newerServerDraft }),
      applyDraft: (d) => applied.push(d),
      setLastEditedAt: (ts) => timestamps.push(ts),
      announce: (m) => announcements.push(m),
    });

    expect(conflictResult).toEqual(newerServerDraft);
    expect(applied).toEqual([newerServerDraft]);
    expect(announcements).toEqual(['Loaded a newer draft from your account.']);
  });

  test('syncDraftWithServer ignores errors and unmounted resolutions', async () => {
    const applied: AccountDraft[] = [];
    const announcements: string[] = [];
    const draft: AccountDraft = { trafficEvent: 'x', targetMode: 'demo', targetOrigin: null, lastEditedAt: 1 };

    expect(
      await syncDraftWithServer(draft, {
        putDraft: async () => ({ ok: false, error: NETWORK_ERROR }),
        applyDraft: (d) => applied.push(d),
        setLastEditedAt: () => {},
        announce: (m) => announcements.push(m),
      }),
    ).toBeNull();

    expect(
      await syncDraftWithServer(draft, {
        putDraft: async () => ({ ok: true, data: draft, conflict: draft }),
        applyDraft: (d) => applied.push(d),
        setLastEditedAt: () => {},
        announce: (m) => announcements.push(m),
        isAlive: () => false,
      }),
    ).toBeNull();

    expect(applied).toEqual([]);
    expect(announcements).toEqual([]);
  });

  test('hydrateSignedInDraft merges stashed local draft via PUT /api/draft before reading remote draft', async () => {
    const storage = memoryStorage();
    const localDraft: AccountDraft = {
      trafficEvent: 'Stashed before sign-in',
      targetMode: 'own',
      targetOrigin: null,
      lastEditedAt: 500,
    };
    stashLocalDraft(localDraft, storage);

    const callOrder: string[] = [];
    const applied: AccountDraft[] = [];
    const timestamps: number[] = [];

    const hydrated = await hydrateSignedInDraft('user_1', {
      takeLocalDraft: () => takeLocalDraft(storage),
      putDraft: async (d) => {
        callOrder.push(`put:${d.trafficEvent}`);
        return { ok: true, data: { ...d, lastEditedAt: 510 } };
      },
      getDraft: async () => {
        callOrder.push('get');
        return {
          ok: true,
          data: { trafficEvent: 'Stashed before sign-in', targetMode: 'own', targetOrigin: null, lastEditedAt: 510 },
        };
      },
      loadReviewState: (uid) => loadReviewState(uid, storage),
      applyDraft: (d) => applied.push(d),
      setLastEditedAt: (ts) => timestamps.push(ts),
      announce: () => {},
    });

    expect(callOrder).toEqual(['put:Stashed before sign-in', 'get']);
    expect(timestamps).toEqual([510]);
    expect(hydrated).toEqual({
      trafficEvent: 'Stashed before sign-in',
      targetMode: 'own',
      targetOrigin: null,
      lastEditedAt: 510,
    });
    expect(applied).toHaveLength(1);
    expect(takeLocalDraft(storage)).toBeNull();
  });

  test('hydrateSignedInDraft preserves active stashed review instead of overwriting with remote draft', async () => {
    const storage = memoryStorage();
    stashReviewState(
      {
        ownerUserId: 'user_1',
        review: makePlanResponse(),
        lastSubmitted: 'Active review text',
        editing: false,
        targetMode: 'demo',
      },
      storage,
    );
    const applied: AccountDraft[] = [];

    const hydrated = await hydrateSignedInDraft('user_1', {
      takeLocalDraft: () => takeLocalDraft(storage),
      putDraft: async (d) => ({ ok: true, data: d }),
      getDraft: async () => ({
        ok: true,
        data: { trafficEvent: 'Older server draft', targetMode: 'demo', targetOrigin: null, lastEditedAt: 300 },
      }),
      loadReviewState: (uid) => loadReviewState(uid, storage),
      applyDraft: (d) => applied.push(d),
      setLastEditedAt: () => {},
      announce: () => {},
    });

    expect(hydrated).toBeNull();
    expect(applied).toEqual([]);
  });

  test('useStudioDraftSync initializes state cleanly during render', () => {
    let snapshot: ReturnType<typeof useStudioDraftSync> | null = null;
    const me: MeResponse = {
      user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
      verifiedOrigin: null,
      pendingVerification: null,
    };
    function Probe() {
      snapshot = useStudioDraftSync({
        me,
        announce: () => {},
        alive: { current: true },
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(snapshot!.text).toBe('');
    expect(snapshot!.targetMode).toBe('demo');
    expect(snapshot!.review).toBeNull();
    expect(snapshot!.editing).toBe(false);
  });
});

describe('NewTest Test Studio composition', () => {
  function renderStudio(overrides?: { config?: Partial<ConfigResponse>; me?: MeResponse | null }): string {
    const config: ConfigResponse = {
      webOrigin: 'https://yue.macro.my.id',
      apiOrigin: 'https://macro.my.id',
      turnstileSiteKey: 'turnstile_test_key',
      runtime: 'runc',
      runtimeError: null,
      examples: [{ label: 'Campaign spike', text: 'Ramp from 20 to 200 visitors over 5 minutes.' }],
      catalog: [{ id: 'store_home', role: 'web', method: 'GET', path: '/' }],
      trafficEventMin: 10,
      trafficEventMax: 1000,
      sampleRunId: 'run_sample_123',
      firebase: null,
      ...overrides?.config,
    };
    const app: AppContextValue = {
      config,
      me: overrides?.me ?? null,
      refreshMe: async () => {},
      navigate: () => {},
      announce: () => {},
    };
    return renderToStaticMarkup(createElement(AppContext.Provider, { value: app }, createElement(NewTest)));
  }

  test('renders Test Studio shell, TargetPicker, TrafficComposer, GateSidebar, and zero style= attributes', () => {
    const html = renderStudio();
    expect(html).toContain('Test Studio');
    expect(html).toContain('Demo Target');
    expect(html).toContain('Own Site');
    expect(html).toContain('Traffic Description');
    expect(html).toContain('Campaign spike');
    expect(html).toContain('Sample report');
    expect(html).toContain('#/run/run_sample_123');
    expect(html).not.toContain('style=');
  });

  test('renders runtimeError banner when runtimeError is present', () => {
    const html = renderStudio({ config: { runtimeError: 'Docker socket unavailable' } });
    expect(html).toContain('Runtime problem');
    expect(html).toContain('Runs cannot start until this is fixed: Docker socket unavailable');
    expect(html).not.toContain('style=');
  });
});