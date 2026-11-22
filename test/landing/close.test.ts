import { describe, expect, test } from 'bun:test';
import { home, href, select } from './helpers.ts';

describe('home page closing CTA', () => {
  test('ends with Measure Safe Capacity before launch day, both theme backdrops, and Test Studio + Probe actions', async () => {
    const h2 = await select(home, 'main > section.lp-atmo h2');
    expect(h2.map((h) => h.text)).toEqual(['Measure Safe Capacity before launch day']);

    const light = await select(home, 'main > section.lp-atmo img.lp-atmo-bg-light');
    const dark = await select(home, 'main > section.lp-atmo img.lp-atmo-bg-dark');
    expect(light.map((i) => i.attrs.get('src'))).toEqual(['/landing/img/dither/sanok-workers.webp']);
    expect(dark.map((i) => i.attrs.get('src'))).toEqual(['/landing/img/dither/dark-horizon.webp']);

    const links = (await select(home, 'main > section.lp-atmo a')).map((a) => [a.text, href(a)]);
    expect(links).toEqual([
      ['Open Test Studio', '/app/'],
      ['Run Containment Probe', '/app/#/probe'],
    ]);
  });
});
