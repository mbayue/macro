import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  shouldAutoCheckDomainConnect,
  stripDomainConnectParam,
} from '../web/landing/src/app/components/VerifyPanel.tsx';
import { AppContext, type AppContextValue } from '../web/landing/src/app/context.tsx';
import { Domains } from '../web/landing/src/app/pages/Domains.tsx';

function renderDomains(me: AppContextValue['me']): string {
  const app = {
    config: { examples: [], catalog: [], trafficEventMin: 10, trafficEventMax: 1000 },
    me,
    refreshMe: async () => {},
    navigate: () => {},
    announce: () => {},
  } as unknown as AppContextValue;
  return renderToStaticMarkup(createElement(AppContext.Provider, { value: app }, createElement(Domains)));
}

describe('Domains page (#/domains)', () => {
  test('prompts signed-out visitors to sign in via anchor link', () => {
    const html = renderDomains(null);
    expect(html).toContain('Domains');
    expect(html).toContain('Sign in to verify a domain');
    expect(html).toContain('href="#/sign-in"');
    expect(html).toContain('Sign in');
  });

  test('renders VerifyPanel when signed in', () => {
    const html = renderDomains({
      user: { id: 'u1', email: 'dev@example.com', githubLogin: null },
      verifiedOrigin: null,
      pendingVerification: null,
    });
    expect(html).toContain('Verify your site');
  });
});

describe('shouldAutoCheckDomainConnect', () => {
  test('ignores hashes without domainConnect=done', () => {
    expect(shouldAutoCheckDomainConnect({ hash: '#/domains', hasPending: true, alreadyVerified: false })).toBe(
      'ignore',
    );
  });

  test('ignores domainConnect=done when domain is already verified so no false error fires', () => {
    expect(
      shouldAutoCheckDomainConnect({
        hash: '#/domains?domainConnect=done',
        hasPending: false,
        alreadyVerified: true,
      }),
    ).toBe('ignore');
  });

  test('waits while pending verification is still hydrating', () => {
    expect(
      shouldAutoCheckDomainConnect({
        hash: '#/domains?domainConnect=done',
        hasPending: false,
        alreadyVerified: false,
      }),
    ).toBe('wait');
  });

  test('checks when pending verification is loaded and domainConnect=done is present', () => {
    expect(
      shouldAutoCheckDomainConnect({
        hash: '#/domains?domainConnect=done',
        hasPending: true,
        alreadyVerified: false,
      }),
    ).toBe('check');
  });
});

describe('stripDomainConnectParam', () => {
  test('removes domainConnect=done while preserving sibling query params', () => {
    expect(stripDomainConnectParam('#/domains?domainConnect=done')).toBe('#/domains');
    expect(stripDomainConnectParam('#/domains?domainConnect=done&foo=bar')).toBe('#/domains?foo=bar');
    expect(stripDomainConnectParam('#/domains?foo=bar&domainConnect=done')).toBe('#/domains?foo=bar');
    expect(stripDomainConnectParam('#/domains')).toBe('#/domains');
  });
});
