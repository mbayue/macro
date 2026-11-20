import { describe, expect, test } from 'bun:test';
import { home, select } from './helpers.ts';

describe('home page Load the deck', () => {
  const LOAD = 'section#load';

  test('is the #load section, headed by the first Stage clause, announced politely', async () => {
    const h2 = await select(home, `${LOAD} h2`);
    expect(h2.map((h) => h.text)).toEqual(['25 users on the deck']);
    expect(h2[0]?.attrs.get('aria-live')).toBe('polite');
  });

  test('shows the measured p95 per route at 25 users from run d28cacd6, slowest route marked', async () => {
    const text = (await select(home, LOAD))[0]?.text ?? '';
    expect(text).toContain('d28cacd6');
    const rows = await select(home, `${LOAD} [data-ui] tbody tr`);
    expect(rows.length).toBe(3);
    expect(rows[0]?.text).toMatch(/^store_home\s*575 ms\s*Slowest$/);
    expect(rows[1]?.text).toMatch(/^catalog_list\s*77 ms$/);
    expect(rows[2]?.text).toMatch(/^product_detail\s*81 ms$/);
  });

  test('is driven by a labelled range input at the first stop, with a button per Stage', async () => {
    const range = (await select(home, `${LOAD} input[type="range"]`))[0];
    expect(range?.attrs.get('min')).toBe('0');
    expect(range?.attrs.get('max')).toBe('15');
    expect(range?.attrs.get('value')).toBe('1');
    expect(range?.attrs.get('aria-valuetext')).toBe('25 users, Stage 1 of 4');
    const label = await select(home, `${LOAD} label[for="${range?.attrs.get('id')}"]`);
    expect(label.map((l) => l.text)).toEqual(['Users on the deck']);
    const stops = await select(home, `${LOAD} li button`);
    expect(stops.map((b) => b.text)).toEqual(['25', '50', '100', '200 users']);
    expect(stops.map((b) => b.attrs.get('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
  });
});
