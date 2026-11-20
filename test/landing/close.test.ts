import { describe, expect, test } from 'bun:test';
import { home, href, select } from './helpers.ts';

describe('home page close', () => {
  const CLOSE = 'section[aria-labelledby="close-title"]';

  test('ends on "Load your own deck" with the DNS TXT step and the live demo action', async () => {
    const h2 = await select(home, `${CLOSE} h2`);
    expect(h2.map((h) => h.text)).toEqual(['Load your own deck']);
    const text = (await select(home, CLOSE))[0]?.text ?? '';
    expect(text).toContain('DNS TXT record');
    const toApp = (await select(home, `${CLOSE} a`)).filter((a) => href(a) === '/app/');
    expect(toApp.map((a) => a.text)).toEqual(['Try the live demo']);
  });

  test('holds the waitlist form at #waitlist: a labelled email field, a submit button and a polite status line', async () => {
    const ids = (await select(home, `${CLOSE} [id="waitlist"]`)).length;
    expect(ids).toBe(1);
    const field = await select(home, `${CLOSE} #waitlist form input[type="email"]`);
    expect(field.length).toBe(1);
    expect(field[0]?.attrs.get('aria-label') ?? '').toMatch(/email/i);
    const submit = await select(home, `${CLOSE} #waitlist form button[type="submit"]`);
    expect(submit.map((b) => b.text)).toEqual(['Join the waitlist']);
    const status = await select(home, `${CLOSE} #waitlist [aria-live="polite"]`);
    expect(status[0]?.text).toContain('paid plans');
    const links = (await select(home, `${CLOSE} #waitlist a`)).map(href);
    expect(links).toContain('/privacy');
  });
});
