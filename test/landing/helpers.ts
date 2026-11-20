/**
 * Page renderer seam: render each landing page to HTML the way the build prerenders it, and check
 * what a visitor receives. Assertions are on rendered output (text, links, ids, alt text), not on
 * components or class names.
 *
 * Shared by the per-section test files in this folder.
 */
import { join } from 'node:path';
import { render, type PageName } from '../../web/landing/src/entry-server.tsx';

export { render, type PageName };

export interface Found {
  attrs: Map<string, string>;
  text: string;
}

/** Every element matching `selector`, with its attributes and its text content. */
export async function select(html: string, selector: string): Promise<Found[]> {
  const found: Found[] = [];
  const open: Found[] = [];
  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        const item: Found = { attrs: new Map(el.attributes), text: '' };
        found.push(item);
        open.push(item);
        if (el.canHaveContent && !el.selfClosing) {
          el.onEndTag(() => {
            open.splice(open.indexOf(item), 1);
          });
        } else {
          open.splice(open.indexOf(item), 1);
        }
      },
      text(chunk) {
        for (const item of open) item.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();
  for (const item of found) item.text = item.text.replace(/\s+/g, ' ').trim();
  return found;
}

export const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export const href = (f: Found) => decode(f.attrs.get('href') ?? '');

export const PAGES: PageName[] = ['home', 'privacy', 'terms', 'not-found'];
export const home = render('home');
export const HERO = 'section[aria-labelledby="hero-title"]';
export const PUBLIC_DIR = join(import.meta.dir, '..', '..', 'web', 'landing', 'public');
