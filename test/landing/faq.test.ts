import { describe, expect, test } from 'bun:test';
import { decode, home, select } from './helpers.ts';

describe('home page limits & open FAQ', () => {
  const LIMITS = 'section#vd-limits';

  test('renders the Demo Target vs Own Site table', async () => {
    const h2 = await select(home, `${LIMITS} h2`);
    expect(h2.map((h) => h.text)).toEqual(['Free on Demo Target, verified for Own Site']);
    const text = decode((await select(home, `${LIMITS} table`))[0]?.text ?? '');
    expect(text).toContain('yue.macro.my.id');
    expect(text).toContain('1 verified HTTPS origin');
    expect(text).toContain('Domain Connect, DNS TXT, or /.well-known/');
  });

  test('renders 4 open product-specific FAQs at #vd-faq without an accordion', async () => {
    const faq = await select(home, '#vd-faq article.lp-faq-item h3');
    expect(faq.length).toBe(4);
    expect((await select(home, '#vd-faq details')).length).toBe(0);
    expect(faq.map((h) => decode(h.text))).toEqual([
      'How do you prove Macro cannot be pointed at someone else\u2019s site?',
      'What stops the AI from inventing numbers in the Capacity Report?',
      'When does Hybrid Inference run on-device versus in the cloud?',
      'Do I need an account or credit card to try it?',
    ]);
  });
});
