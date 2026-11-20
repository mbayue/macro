/**
 * The visible text of a rendered page's <main>, one line per page, for comparing legal wording across
 * redesigns. Tags become spaces, entities are decoded, whitespace is collapsed, so markup and styling
 * can change freely while any change to the words shows up.
 *
 *   bun test/legal-text.ts   # print the current privacy and terms text (used to write the fixture)
 */
import { render, type PageName } from '../web/landing/src/entry-server.tsx';

export function mainText(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
  return main
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LEGAL_PAGES = ['privacy', 'terms'] as const satisfies readonly PageName[];

if (import.meta.main) {
  const out = Object.fromEntries(LEGAL_PAGES.map((p) => [p, mainText(render(p))]));
  console.log(JSON.stringify(out, null, 2));
}
