import { describe, expect, test } from 'bun:test';
import { home, href, select } from './helpers.ts';

describe('home page hero & interactive workbench', () => {
  test('renders the floating site header with Pipeline, Proof, Limits, FAQ links, theme toggle, and Open Studio', async () => {
    const header = await select(home, 'header[aria-label="Site"]');
    expect(header.length).toBe(1);
    const navAnchors = (await select(home, 'header nav[aria-label="Primary"] a')).map((a) => [a.text, href(a)]);
    expect(navAnchors).toEqual([
      ['Pipeline', '#vd-pipeline'],
      ['Proof', '#vd-proof'],
      ['Limits', '#vd-limits'],
      ['FAQ', '#vd-faq'],
    ]);
    expect((await select(home, 'header button[aria-label="Dark mode"][data-theme-toggle]')).length).toBe(1);
    const studio = (await select(home, 'header a')).find((a) => href(a) === '/app/');
    expect(studio?.text).toBe('Open Studio');
  });

  test('renders the H1, balanced hero copy, and primary + probe CTAs', async () => {
    const h1 = await select(home, 'h1');
    expect(h1.map((h) => h.text)).toEqual(['Find your breaking point']);
    const ctas = (await select(home, '.lp-cta-row a')).map((a) => [a.text, href(a)]);
    expect(ctas.slice(0, 2)).toEqual([
      ['Try the Demo Target', '/app/'],
      ['Run 5/5 Containment Probe', '/app/#/probe'],
    ]);
  });

  test('renders both light (Sanok trucks WebP) and dark (horizon WebP) hero backdrops for zero-flash switching', async () => {
    const light = await select(home, '#island-hero img.lp-atmo-bg-light');
    const dark = await select(home, '#island-hero img.lp-atmo-bg-dark');
    expect(light.map((i) => i.attrs.get('src'))).toEqual(['/landing/img/dither/sanok-trucks.webp']);
    expect(dark.map((i) => i.attrs.get('src'))).toEqual(['/landing/img/dither/dark-horizon.webp']);
  });

  test('renders the 3-tab workbench with clickable rail buttons and real d28cacd6 Stage 3 Safe Capacity data', async () => {
    const tabs = (await select(home, '[role="tablist"] [role="tab"]')).map((t) => [
      t.text,
      t.attrs.get('aria-selected'),
      t.attrs.get('aria-controls'),
    ]);
    expect(tabs).toEqual([
      ['Capacity Report', 'true', 'wb-panel-report'],
      ['Policy Gate', 'false', 'wb-panel-gate'],
      ['Containment 5/5', 'false', 'wb-panel-probe'],
    ]);
    const panel = await select(home, '[role="tabpanel"]#wb-panel-report[aria-labelledby="wb-tab-report"]');
    expect(panel.length).toBe(1);
    const railButtons = await select(home, 'aside[aria-label="Workbench sections"] button[aria-pressed]');
    expect(railButtons.length).toBe(3);

    const workbench = (await select(home, '[aria-label="Interactive Macro workbench"]'))[0]?.text ?? '';
    expect(workbench).toContain('run d28cacd6');
    expect(workbench).toContain('100 VUs');
    expect(workbench).toContain('910 ms');
    expect(workbench).toContain('Stop limit 1,000 ms');
  });

  test('keeps a skip link bypassing the nav header to #hero-content inside main', async () => {
    const skip = (await select(home, 'a')).find((a) => a.text === 'Skip to content');
    expect(skip && href(skip)).toBe('#hero-content');
    expect((await select(home, 'main #hero-content')).length).toBe(1);
  });
});
