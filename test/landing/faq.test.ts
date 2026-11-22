import { describe, expect, test } from 'bun:test';
import { decode, home, href, select } from './helpers.ts';

describe('home page limits & open FAQ', () => {
  const LIMITS = 'section#vd-limits';
  const FAQ = 'section#vd-faq';

  test('renders the early-access $0 Self-host and Hosted cards plus Demo Target vs Own Site table', async () => {
    const h2 = await select(home, `${LIMITS} h2`);
    expect(h2.map((h) => h.text)).toEqual(['Free while in early access']);

    const planTitles = (await select(home, `${LIMITS} .lp-plan-grid article h3`)).map((h) => h.text);
    expect(planTitles).toEqual(['Self-host', 'Hosted early access']);
    for (const card of await select(home, `${LIMITS} .lp-plan-grid article`)) {
      expect(card.text).toContain('$0');
    }
    const planLinks = (await select(home, `${LIMITS} .lp-plan-grid a`)).map((a) => [a.text, href(a)]);
    expect(planLinks).toEqual([
      ['View on GitHub', 'https://github.com/mbayue/macro'],
      ['Open Test Studio', '/app/'],
    ]);

    const table = decode((await select(home, `${LIMITS} table`))[0]?.text ?? '');
    expect(table).toContain('yue.macro.my.id');
    expect(table).toContain('1 verified HTTPS origin');
    expect(table).toContain('Domain Connect, DNS TXT, or /.well-known/');
  });

  test('renders 4 open product-specific FAQs in a separate section#vd-faq without an accordion', async () => {
    const h2 = await select(home, `${FAQ} h2`);
    expect(h2.map((h) => h.text)).toEqual(['Frequently asked questions']);

    const faq = await select(home, `${FAQ} article.lp-faq-item h3`);
    expect(faq.length).toBe(4);
    expect((await select(home, `${FAQ} details`)).length).toBe(0);
    expect(faq.map((h) => decode(h.text))).toEqual([
      'How do you prove Macro cannot be pointed at someone else\u2019s site?',
      'What stops the AI from inventing numbers in the Capacity Report?',
      'When does Hybrid Inference run on-device versus in the cloud?',
      'Do I need an account or credit card to try it?',
    ]);
  });
});
