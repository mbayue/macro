import { describe, expect, test } from 'bun:test';
import { decode, home, select } from './helpers.ts';

describe('home page Sanok proof, Hybrid Inference & Number Guard', () => {
  const PROOF = 'section#vd-proof';

  test('renders the 4 Bayer-dithered Sanok bridge plates with static test selected by default', async () => {
    const h2 = await select(home, `${PROOF} h2`);
    expect(h2.map((h) => h.text)).toEqual(['On-device AI when available. Measured numbers always.']);

    const thumbs = await select(home, `${PROOF} button.lp-photo-thumb`);
    expect(thumbs.length).toBe(4);
    expect(thumbs.map((t) => t.attrs.get('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);

    const plate = (await select(home, `${PROOF} figure.lp-plate img`))[0];
    expect(plate?.attrs.get('src')).toBe('/landing/img/dither/sanok-static.webp');
  });

  test('names On-Device Model, Cloud Fallback, Scenario Assistant, Report Q&A and cites real run d28cacd6 per-route p95s', async () => {
    const text = decode((await select(home, PROOF))[0]?.text ?? '');
    for (const term of ['Hybrid Inference', 'On-Device Model', 'Cloud Fallback', 'Scenario Assistant', 'Report Q&A', 'Number Guard']) {
      expect(text).toContain(term);
    }
    expect(text).toContain('d28cacd6');
    expect(text).toContain('store_home');
    expect(text).toContain('910 ms');
    expect(text).toContain('catalog_list');
    expect(text).toContain('226 ms');
    expect(text).toContain('product_detail');
    expect(text).toContain('138 ms');
  });
});
