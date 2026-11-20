import { describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConfigResponse, EventView, MeResponse, RunView } from '../src/api-types.ts';
import { AppContext, type AppContextValue } from '../web/landing/src/app/context.tsx';
import { PROBE_ACTIONS } from '../web/landing/src/app/lib/probe-view.ts';
import { NotFound } from '../web/landing/src/app/pages/NotFound.tsx';
import { ProbeBody, ProbePage } from '../web/landing/src/app/pages/Probe.tsx';
import { ProbeStart } from '../web/landing/src/app/pages/ProbeStart.tsx';
import { AccountPanel, EmailLinkPanel, SignIn } from '../web/landing/src/app/pages/SignIn.tsx';
import { VerifyPanel } from '../web/landing/src/app/components/VerifyPanel.tsx';

function assertNoInlineStyle(html: string): void {
  expect(html).not.toMatch(/\sstyle=/i);
}

function makeConfig(overrides?: Partial<ConfigResponse>): ConfigResponse {
  return {
    webOrigin: 'https://yue.macro.my.id',
    apiOrigin: 'https://api.macro.my.id',
    turnstileSiteKey: '1x00000000000000000000AA',
    runtime: 'runsc',
    runtimeError: null,
    examples: [],
    catalog: [],
    trafficEventMin: 10,
    trafficEventMax: 1000,
    sampleRunId: null,
    firebase: null,
    googleSignIn: false,
    ...overrides,
  };
}

function makeAppContext(overrides?: {
  config?: Partial<ConfigResponse>;
  me?: MeResponse | null;
}): AppContextValue {
  return {
    config: makeConfig(overrides?.config),
    me: overrides?.me ?? null,
    refreshMe: async () => {},
    navigate: () => {},
    announce: () => {},
  };
}

function renderWithApp(node: ReactNode, ctxOverrides?: { config?: Partial<ConfigResponse>; me?: MeResponse | null }): string {
  return renderToStaticMarkup(createElement(AppContext.Provider, { value: makeAppContext(ctxOverrides) }, node));
}

describe('NotFound view', () => {
  test('renders clean Test Studio and Runs Table links without an eyebrow 404 badge or style= attributes', () => {
    const html = renderToStaticMarkup(createElement(NotFound));

    expect(html).toContain('<h1');
    expect(html).toContain('Page not found');
    expect(html).not.toContain('404');
    expect(html).not.toContain('data-slot="badge"');
    expect(html).toContain('href="#/"');
    expect(html).toContain('Test Studio');
    expect(html).toContain('href="#/runs"');
    expect(html).toContain('Runs Table');
    expect(html).toContain('data-slot="button"');
    assertNoInlineStyle(html);
  });
});

describe('ProbeStart view', () => {
  test('renders 5 escape attempts (a)..(e), runtime & caps in Geist Mono, Turnstile slot, and shadcn Button with zero style= attributes', () => {
    const html = renderWithApp(createElement(ProbeStart), {
      config: { runtime: 'runsc', webOrigin: 'https://yue.macro.my.id' },
    });

    expect(html).toContain('Containment Probe');
    for (const action of PROBE_ACTIONS) {
      expect(html).toContain(`(${action.id})`);
      expect(html).toContain(action.label);
    }
    expect(html).toContain('runsc');
    expect(html).toContain('60 s');
    expect(html).toContain('1 GiB');
    expect(html).toContain('yue.macro.my.id:443');
    expect(html).toContain('class="turnstile"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('Run containment probe');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
    expect(html).not.toContain('class="attempts');
    expect(html).not.toContain('class="panel');
    assertNoInlineStyle(html);
  });
});

function makeProbeRun(overrides?: Partial<RunView>): RunView {
  return {
    id: 'probe_test_1',
    kind: 'probe',
    planHash: null,
    status: 'completed',
    statusReason: null,
    runtime: 'runsc',
    startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
    endedAt: Date.UTC(2026, 4, 21, 14, 3, 52),
    visibility: 'public',
    probeResult: {
      actions: {
        a: 'contained',
        b: 'contained',
        c: 'contained',
        d: 'contained',
        e: 'contained',
      },
      result: 'passed',
      escaped: [],
    },
    ...overrides,
  };
}

describe('Probe view', () => {
  test('ProbePage renders loading status and What each action does disclosure with zero style= attributes', () => {
    const html = renderWithApp(createElement(ProbePage, { id: 'probe_loading_1' }));

    expect(html).toContain('Containment Probe');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('What each action does');
    expect(html).toContain('<details');
    expect(html).not.toContain('class="explain');
    expect(html).not.toContain('class="skeleton-pulse');
    assertNoInlineStyle(html);
  });

  test('ProbeBody renders passed 5/5 banner with bg-primary text-primary-foreground, table caption, UTC <time> events, and zero style= attributes', () => {
    const events = new Map<number, EventView>([
      [
        1,
        {
          id: 1,
          type: 'containment',
          runId: 'probe_test_1',
          stageIdx: null,
          payload: { type: 'sandbox_created' },
          ts: Date.UTC(2026, 4, 21, 14, 3, 8),
        },
      ],
      [
        2,
        {
          id: 2,
          type: 'containment',
          runId: 'probe_test_1',
          stageIdx: null,
          payload: { type: 'egress_blocked', host: 'example.com', port: 443 },
          ts: Date.UTC(2026, 4, 21, 14, 3, 12),
        },
      ],
    ]);

    const html = renderWithApp(
      createElement(ProbeBody, {
        run: makeProbeRun(),
        events,
        pollFailed: false,
      }),
    );

    expect(html).toContain('5/5');
    expect(html).toContain('Probe passed');
    expect(html).toContain('bg-primary');
    expect(html).toContain('text-primary-foreground');
    expect(html).toContain('text-accent-ink-soft');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
    expect(html).toContain('<caption');
    expect(html).toContain('The five probe actions, in the order they run');
    expect(html).toContain('<time');
    expect(html).toContain('2026-05-21 14:03:08 UTC');
    expect(html).toContain('Egress blocked: example.com:443');
    expect(html).not.toContain('probe-result--passed');
    expect(html).not.toContain('feed__list');
    assertNoInlineStyle(html);
  });

  test('ProbeBody renders failed (border-destructive), incomplete (border-warn), and running states cleanly', () => {
    const failedHtml = renderWithApp(
      createElement(ProbeBody, {
        run: makeProbeRun({
          probeResult: {
            actions: { a: 'escaped', b: 'contained', c: 'contained', d: 'contained', e: 'contained' },
            result: 'failed',
            escaped: ['a'],
          },
        }),
        events: new Map(),
        pollFailed: false,
      }),
    );
    expect(failedHtml).toContain('4/5');
    expect(failedHtml).toContain('Probe failed');
    expect(failedHtml).toContain('border-destructive');
    expect(failedHtml).toContain('escaped');
    assertNoInlineStyle(failedHtml);

    const incompleteHtml = renderWithApp(
      createElement(ProbeBody, {
        run: makeProbeRun({
          status: 'timed_out',
          probeResult: {
            actions: { a: 'contained', b: 'contained', c: 'contained', d: 'contained', e: 'no result' },
            result: 'incomplete',
            escaped: [],
          },
        }),
        events: new Map(),
        pollFailed: false,
      }),
    );
    expect(incompleteHtml).toContain('4/5');
    expect(incompleteHtml).toContain('Probe incomplete');
    expect(incompleteHtml).toContain('border-warn');
    expect(incompleteHtml).toContain('no result');
    assertNoInlineStyle(incompleteHtml);

    const runningHtml = renderWithApp(
      createElement(ProbeBody, {
        run: makeProbeRun({ status: 'running', endedAt: null, probeResult: null }),
        events: new Map(),
        pollFailed: true,
      }),
    );
    expect(runningHtml).toContain('The probe is running.');
    expect(runningHtml).toContain('Could not refresh the probe. Trying again.');
    expect(runningHtml).toContain('No containment events yet.');
    assertNoInlineStyle(runningHtml);
  });
});

function withMockWindowHash<T>(hash: string, fn: () => T): T {
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { hash } };
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prev;
    }
  }
}

describe('SignIn view (signed out)', () => {
  test('renders explicit label for/id email field, autocomplete="email", submit button, GitHub link, optional Google link, and zero style= attributes', () => {
    const html = renderWithApp(createElement(SignIn), {
      config: { googleSignIn: false },
      me: null,
    });

    const forMatch = html.match(/<label[^>]*for="([^"]+)"[^>]*>Email<\/label>/);
    expect(forMatch).not.toBeNull();
    const inputId = forMatch?.[1];
    expect(inputId).toBeTruthy();

    expect(html).toContain(`id="${inputId}"`);
    expect(html).toContain('type="email"');
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toContain('aria-invalid="false"');
    const describedMatch = html.match(/aria-describedby="([^"]+)"/);
    expect(describedMatch).not.toBeNull();
    for (const id of (describedMatch?.[1] ?? '').split(/\s+/)) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('role="alert"');
    expect(html).toContain('Send sign-in link');
    expect(html).toContain('Back to Test Studio');
    expect(html).not.toContain('Back to new test');
    expect(html).toContain('href="/api/auth/github/start"');
    expect(html).not.toContain('href="/api/auth/google/start"');
    expect(html).toContain('data-slot="button"');
    expect(html).not.toContain('class="field"');
    expect(html).not.toContain('class="panel"');
    assertNoInlineStyle(html);

    const withGoogleHtml = renderWithApp(createElement(SignIn), {
      config: { googleSignIn: true },
      me: null,
    });
    expect(withGoogleHtml).toContain('href="/api/auth/google/start"');
    expect(withGoogleHtml).toContain('Continue with Google');
    assertNoInlineStyle(withGoogleHtml);
  });

  test('renders github_email and google_email OAuth errors from hash query params in role="alert"', () => {
    const githubHtml = withMockWindowHash('#/sign-in?error=github_email', () =>
      renderWithApp(createElement(SignIn), { me: null }),
    );
    expect(githubHtml).toContain('role="alert"');
    expect(githubHtml).toContain('GitHub did not provide a verified email');
    assertNoInlineStyle(githubHtml);

    const googleHtml = withMockWindowHash('#/sign-in?error=google_email', () =>
      renderWithApp(createElement(SignIn), { me: null }),
    );
    expect(googleHtml).toContain('role="alert"');
    expect(googleHtml).toContain('Google did not provide a verified email');
    assertNoInlineStyle(googleHtml);
  });

  test('EmailLinkPanel links validation/API error via aria-invalid="true" and aria-describedby to role="alert", plus sent/cooldown status', () => {
    const errHtml = renderToStaticMarkup(
      createElement(EmailLinkPanel, {
        email: 'bad-email',
        busy: false,
        sent: false,
        wait: 0,
        error: 'Enter a valid email address.',
        onEmailChange: () => {},
        onSubmit: () => {},
        onBack: () => {},
      }),
    );

    expect(errHtml).toContain('aria-invalid="true"');
    const describedMatch = errHtml.match(/aria-describedby="([^"]+)"/);
    expect(describedMatch).not.toBeNull();
    const ids = (describedMatch?.[1] ?? '').split(/\s+/);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      expect(errHtml).toContain(`id="${id}"`);
    }
    expect(errHtml).toContain('role="alert"');
    expect(errHtml).toContain('Enter a valid email address.');
    assertNoInlineStyle(errHtml);

    const sentCooldownHtml = renderToStaticMarkup(
      createElement(EmailLinkPanel, {
        email: 'dev@example.com',
        busy: false,
        sent: true,
        wait: 42,
        error: null,
        onEmailChange: () => {},
        onSubmit: () => {},
        onBack: () => {},
      }),
    );
    expect(sentCooldownHtml).toContain('role="status"');
    expect(sentCooldownHtml).toContain('Check your email for a sign-in link.');
    expect(sentCooldownHtml).toContain('Wait 42s');
    assertNoInlineStyle(sentCooldownHtml);
  });
});

describe('SignIn view (signed in / Account view)', () => {
  test('displays signed-in githubLogin or email identity, original Session active + Delete account layout, Glossary copy, and zero style= attributes', () => {
    const githubUserHtml = renderWithApp(createElement(SignIn), {
      me: {
        user: { id: 'u_1', email: 'bayu@example.com', githubLogin: 'mbayue' },
        verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        pendingVerification: null,
      },
    });

    expect(githubUserHtml).toContain('Account');
    expect(githubUserHtml).toContain('mbayue');
    expect(githubUserHtml).toContain('Session active');
    expect(githubUserHtml).not.toContain('Signed in');
    expect(githubUserHtml).not.toContain('Verified origin');
    expect(githubUserHtml).not.toContain('shop.example.com');
    expect(githubUserHtml).toContain('Back to Test Studio');
    expect(githubUserHtml).not.toContain('Back to new test');
    expect(githubUserHtml).toContain('href="#/runs"');
    expect(githubUserHtml).toContain('View Runs Table');
    expect(githubUserHtml).toContain('Sign out');
    expect(githubUserHtml).toContain('Delete account');
    expect(githubUserHtml).toContain('data-slot="button"');
    assertNoInlineStyle(githubUserHtml);

    const emailUserHtml = renderWithApp(createElement(SignIn), {
      me: {
        user: { id: 'u_2', email: 'only-email@example.com', githubLogin: null },
        verifiedOrigin: null,
        pendingVerification: null,
      },
    });
    expect(emailUserHtml).toContain('only-email@example.com');
    assertNoInlineStyle(emailUserHtml);
  });

  test('AccountPanel renders deleting state and deleteError inside role="alert" cleanly', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        me: {
          user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
          verifiedOrigin: null,
          pendingVerification: null,
        },
        signingOut: false,
        deleting: true,
        deleteError: 'Could not reach the server.',
        onBack: () => {},
        onSignOut: () => {},
        onDelete: () => {},
      }),
    );

    expect(html).toContain('Deleting…');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not reach the server.');
    assertNoInlineStyle(html);
  });
});

describe('VerifyPanel view', () => {
  function assertValidHostForm(html: string): void {
    expect(html).toMatch(/<form[^>]*novalidate/i);
    const forMatch = html.match(/<label[^>]*for="([^"]+)"[^>]*>Host or https origin<\/label>/);
    expect(forMatch).not.toBeNull();
    const inputId = forMatch?.[1];
    expect(inputId).toBeTruthy();
    expect(html).toContain(`id="${inputId}"`);
    expect(html).toContain('aria-invalid="false"');
    const describedMatch = html.match(/aria-describedby="([^"]+)"/);
    expect(describedMatch).not.toBeNull();
    const ids = (describedMatch?.[1] ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
    assertNoInlineStyle(html);
  }

  test('renders VerifyHostForm with noValidate, label/input wiring, aria-invalid, and aria-describedby in both unverified and verified states', () => {
    const unverifiedHtml = renderWithApp(createElement(VerifyPanel), {
      me: {
        user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
        verifiedOrigin: null,
        pendingVerification: null,
      },
    });
    assertValidHostForm(unverifiedHtml);

    const verifiedHtml = renderWithApp(createElement(VerifyPanel), {
      me: {
        user: { id: 'u_1', email: 'dev@example.com', githubLogin: null },
        verifiedOrigin: { origin: 'https://shop.example.com', host: 'shop.example.com' },
        pendingVerification: null,
      },
    });
    expect(verifiedHtml).toContain('Verify a different host');
    assertValidHostForm(verifiedHtml);
  });
});
