import { describe, expect, test } from 'bun:test';
import { decode, home, select } from './helpers.ts';

describe('home page wording (#13 review)', () => {
  /** Visible text of the home page, without the h1 (a sentence) and the app's own literal fragments (data-ui). */
  async function prose(html: string): Promise<string> {
    const out = await new HTMLRewriter()
      .on('h1, [data-ui], script', { element: (el) => void el.remove() })
      .transform(new Response(html))
      .text();
    return decode(out.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
  }

  test.each([
    'Test Studio', 'Runs Table', 'Run Compare', 'Capacity Report', 'Containment Probe', 'Policy Gate', 'Number Guard',
    'Breaking Point', 'Safe Capacity', 'On-Device Model', 'Cloud Fallback', 'Scenario Assistant', 'Report Q&A', 'Supervisor',
    'Approve & Run', 'Stage',
  ])('writes the glossary term "%s" in its glossary case', async (term) => {
    const text = await prose(home);
    const pattern = new RegExp(`\\b${term.replace(/[&]/g, '(?:&|and)').replace(/ /g, '\\s+')}s?\\b`, 'gi');
    const wrong = (text.match(pattern) ?? []).filter((m) => !m.startsWith(term));
    expect(wrong).toEqual([]);
  });

  test('the gate names the app action "Approve & Run"', async () => {
    const section = decode((await select(home, 'section[aria-labelledby="gate-title"]'))[0]?.text ?? '');
    expect(section).toContain('ready to Approve & Run');
  });

  test('Hybrid AI claims only what the app does: Cloud Fallback whenever the On-Device Model is not available', async () => {
    const text = decode((await select(home, 'section[aria-labelledby="hybrid-title"]'))[0]?.text ?? '');
    expect(text).not.toContain('Any other browser');
    expect(text).not.toContain('Every answer is labelled');
    expect(text).toMatch(/On-Device Model is not available/);
  });
});
