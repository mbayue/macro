import { describe, expect, test } from 'bun:test';
import { home, select } from './helpers.ts';

describe('home page deterministic pipeline', () => {
  const PIPELINE = 'section#vd-pipeline';

  test('lists all 4 deterministic execution nodes with Policy Gate selected by default', async () => {
    const h2 = await select(home, `${PIPELINE} h2`);
    expect(h2.map((h) => h.text)).toEqual(['How every run stays deterministic and contained']);

    const nodes = await select(home, `${PIPELINE} button.lp-node`);
    expect(nodes.length).toBe(4);
    expect(nodes.map((n) => n.attrs.get('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);

    const section = (await select(home, PIPELINE))[0]?.text ?? '';
    for (const label of ['Traffic Description', 'Policy Gate', 'gVisor + Egress Proxy', 'Number Guard']) {
      expect(section).toContain(label);
    }
    expect(section).toContain('Approved Plan (locked hash)');
  });
});
