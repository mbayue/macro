import { describe, expect, test } from 'bun:test';
import { decode, home, href, select } from './helpers.ts';

describe('home page explainers: measured, then opened, and Hybrid AI', () => {
  const WHY = 'section[aria-labelledby="why-title"]';

  test('"Measured, then opened" says who decides what: the AI drafts, fixed code decides, the Number Guard checks', async () => {
    const heading = await select(home, `${WHY} h2`);
    expect(heading.map((h) => h.text)).toEqual(['Measured, then opened']);
    const points = (await select(home, `${WHY} li`)).map((li) => li.text);
    expect(points).toEqual([
      'The AI drafts the plan and writes the explanation.',
      'Fixed code decides the target, the limits, the script and the stop rule.',
      'Every number in the AI text is checked against the measurements, or the text is withheld.',
    ]);
  });

  test('"Measured, then opened" shows a credited Sanok photograph described as the bridge test', async () => {
    const imgs = await select(home, `${WHY} img`);
    expect(imgs.length).toBe(1);
    expect(imgs[0]?.attrs.get('src')).toMatch(/^\/landing\/img\/sanok\//);
    expect(imgs[0]?.attrs.get('alt')).toMatch(/Sanok bridge/);
    expect(imgs[0]?.attrs.get('srcset')).toContain('800w');
  });

  const AI = 'section[aria-labelledby="hybrid-title"]';

  test('Hybrid AI names the On-Device Model, Cloud Fallback, Scenario Assistant and Report Q&A', async () => {
    const heading = await select(home, `${AI} h2`);
    expect(heading.map((h) => h.text)).toEqual(['Hybrid AI']);
    const text = decode((await select(home, AI))[0]?.text ?? '');
    for (const term of ['Hybrid Inference', 'On-Device Model', 'Gemini Nano', 'Chrome', 'Cloud Fallback', 'Scenario Assistant', 'Report Q&A']) {
      expect(text).toContain(term);
    }
  });

  test('Hybrid AI links into the app', async () => {
    const links = (await select(home, `${AI} a`)).map(href);
    expect(links).toContain('/app/');
  });
});
