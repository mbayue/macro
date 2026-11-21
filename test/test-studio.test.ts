import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanResponse } from '../src/api-types.ts';
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