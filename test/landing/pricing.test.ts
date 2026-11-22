import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Pricing } from '../../web/landing/src/components/Pricing.tsx';
import { home, href, select } from './helpers.ts';

describe('paid-plan pricing (kept for when paid tiers launch, not on the page)', () => {
  const paid = renderToString(createElement(Pricing));

  test('is not rendered on the home page', () => {
    expect(home).not.toContain('Priced by site');
  });

  test('renders once, under one "Priced by site" heading', async () => {
    expect((await select(paid, 'h2')).map((h) => h.text)).toEqual(['Priced by site']);
    expect(paid).not.toMatch(/<[^>]*\sstyle=/i);
  });

  test('shows Free, Pro and Team with their prices, limits and actions', async () => {
    expect((await select(paid, 'article h3')).map((h) => h.text)).toEqual(['Free', 'Pro', 'Team']);
    const plans = (await select(paid, 'article')).map((p) => p.text);
    expect(plans.length).toBe(3);
    [['$0', 'forever'], ['$9', 'per month'], ['$29', 'per month']].forEach(([price, period], i) => {
      expect(plans[i]).toContain(`${price} ${period}`);
    });
    const labels = ['Verified sites', 'Peak virtual users', 'Runs per month', 'Run history', 'Containment Probe', 'Support'];
    expect((await select(paid, 'article dt')).map((d) => d.text)).toEqual([...labels, ...labels, ...labels]);
    expect((await select(paid, 'article dd')).map((d) => d.text)).toEqual([
      ...['1', '100', '10', '7 days', 'Included', 'Community'],
      ...['3', '300', '100', '90 days', 'Included', 'Email'],
      ...['10', '500', '400', '1 year', 'Included', 'Priority email'],
    ]);
    const links = (await select(paid, 'article a')).map((a) => [a.text, href(a)]);
    expect(links).toEqual([
      ['Try the live demo', '/app/'],
      ['Join the waitlist', '#waitlist'],
      ['Join the waitlist', '#waitlist'],
    ]);
  });
});
