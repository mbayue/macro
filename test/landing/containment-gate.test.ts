import { describe, expect, test } from 'bun:test';
import { decode, home, select } from './helpers.ts';

describe('home page containment and gate (#16)', () => {
  const PROOF = 'section#containment';

  test('Containment lists the five escape attempts the probe blocks, each contained', async () => {
    const section = (await select(home, PROOF))[0]?.text ?? '';
    expect(section).toContain('Five escapes, five blocked');
    expect(section).toContain('Containment Probe');
    for (const name of ['example.com', '169.254.169.254', 'macro-api:3000', 'KEY, SECRET, TOKEN', 'Over 1 GiB']) {
      expect(section).toContain(name);
    }
    expect(section.match(/Contained/g)?.length).toBe(5);
  });
});

describe('home page gate switch (#16)', () => {
  const GATE = 'section[aria-labelledby="gate-title"]';

  test('offers "Your site" and "Someone else\'s" as a two-option pressed-state switch, "Your site" first and pressed', async () => {
    const buttons = await select(home, `${GATE} button[aria-pressed]`);
    expect(buttons.map((b) => decode(b.text))).toEqual(['Your site', 'Someone else\u2019s']);
    expect(buttons.map((b) => b.attrs.get('aria-pressed'))).toEqual(['true', 'false']);
  });

  test('announces the answer politely and says yes for the verified demo target', async () => {
    const h2 = (await select(home, `${GATE} h2[aria-live="polite"]`))[0];
    expect(h2?.text).toBe('The gate says yes');
    const section = (await select(home, GATE))[0]?.text ?? '';
    expect(section).toContain('https://yue.macro.my.id');
    expect(section).toContain('25, 50, 100, 200 users, 240 s');
  });

  test('carries the rejection: rule 4.2, target not verified, 0 requests sent, no approve button', async () => {
    const section = (await select(home, GATE))[0]?.text ?? '';
    expect(section).toContain('Rule 4.2');
    expect(section).toContain('is not verified');
    expect(section).toContain('0 requests sent');
    expect(section).toContain('no approve button');
  });
});
