import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const REQUIRED_FILES = ['index.html', 'privacy.html', 'terms.html', '404.html', join('app', 'index.html'), 'favicon.svg'] as const;
const LANDING_PAGES = ['index.html', 'privacy.html', 'terms.html', '404.html'] as const;
const GEIST_MONO_FONT = '/landing/fonts/geist-mono-400.woff2';

const STYLE_TAG_RE = /<style\b[^>]*>/i;
const OPENING_TAG_RE = /<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const QUOTED_VALUE_RE = /"[^"]*"|'[^']*'/g;
const ATTR_STYLE_RE = /(?:^|\s)style\s*=/i;
const ATTR_SRC_RE = /(?:^|\s)src\s*=/i;
const LINK_TAG_RE = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTR_REL_RE = /(?:^|\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_HREF_RE = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const APP_CSS_HREF_RE = /(?:(?:^|\/)(?:app|tailwind)(?:-[^/"'?#]+)?\.css(?:[?#]|$)|\/src\/app\/)/i;

function extractAttr(attrs: string, re: RegExp): string | undefined {
  const match = re.exec(attrs);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function extractLinkTags(html: string): { rel: string; href: string }[] {
  const links: { rel: string; href: string }[] = [];
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const attrs = match[1] ?? '';
    const rel = extractAttr(attrs, ATTR_REL_RE) ?? '';
    const href = extractAttr(attrs, ATTR_HREF_RE) ?? '';
    if (href !== '') links.push({ rel: rel.toLowerCase(), href });
  }
  return links;
}

function inspectHtmlTags(html: string): { hasStyleAttr: boolean; hasInlineScript: boolean } {
  let hasStyleAttr = false;
  let hasInlineScript = false;

  for (const match of html.matchAll(OPENING_TAG_RE)) {
    const tagName = match[1]?.toLowerCase() ?? '';
    const attrs = match[2] ?? '';
    const unquotedAttrs = attrs.replace(QUOTED_VALUE_RE, '""');

    if (ATTR_STYLE_RE.test(unquotedAttrs)) {
      hasStyleAttr = true;
    }
    const isLdJson = tagName === 'script' && /type\s*=\s*["']application\/ld\+json["']/i.test(attrs);
    if (tagName === 'script' && !ATTR_SRC_RE.test(unquotedAttrs) && !isLdJson) {
      hasInlineScript = true;
    }
    if (hasStyleAttr && hasInlineScript) break;
  }

  return { hasStyleAttr, hasInlineScript };
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const JSX_STYLE_PROP_RE = /\bstyle\s*=\s*\{/;
const LEGACY_REACT_API_RE = /\b(useContext|forwardRef)\s*(?:<[^>]+>)?\s*\(/;
const APP_SHADOW_RE = /\bshadow-(?!none\b)[a-z0-9[\]_-]+/;
const APP_BACKDROP_BLUR_RE = /\bbackdrop-blur(?:-[a-z0-9[\]_-]+)?\b/;
const ANIMATE_CLASS_RE = /\banimate-(?!none\b)[a-z0-9_-]+/;
/** Landing pages (everything outside app/) use theme colour tokens and the one radius; see docs/landing.md. */
const LANDING_RAW_HEX_RE = /-\[(#[0-9a-fA-F]{3,8})\]/;
const LANDING_ARBITRARY_RADIUS_RE = /\brounded(?:-[a-z]+)?-\[/;
const LANDING_APP_TOKEN_RE = /\b(?:text|bg|border)-(?:muted-foreground|foreground|background|popover(?:-foreground)?|card(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|destructive(?:-foreground)?)\b/;
const EM_DASH = '\u2014';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

async function collectFiles(dir: string, root: string, matcher: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, root, matcher)));
    } else if (entry.isFile() && matcher(entry.name)) {
      files.push(relative(root, fullPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

/** Validates frontend sources: no JSX `style={...}` props or legacy React APIs anywhere; on landing pages (outside `app/`) also no raw hex colours, arbitrary radii or em dashes. */
export async function validateWebSource(srcDir: string): Promise<string[]> {
  if (!existsSync(srcDir)) return [];
  const errors: string[] = [];
  const sourceFiles = await collectFiles(srcDir, srcDir, (name) => SOURCE_EXTENSIONS.has(name.slice(name.lastIndexOf('.'))));

  for (const relPath of sourceFiles) {
    const raw = await readFile(join(srcDir, relPath), 'utf8');
    const code = stripComments(raw);
    if (relPath.endsWith('.tsx') && JSX_STYLE_PROP_RE.test(code)) {
      errors.push(`${relPath} contains a JSX style={...} prop, which the CSP blocks.`);
    }
    const legacyMatch = LEGACY_REACT_API_RE.exec(code);
    if (legacyMatch !== null) {
      errors.push(`${relPath} calls legacy React API ${legacyMatch[1]}(); use React 19 use() or ref-as-prop instead.`);
    }
    if (relPath.endsWith('.tsx')) {
      for (const line of code.split('\n')) {
        if (ANIMATE_CLASS_RE.test(line) && !line.includes('motion-reduce:')) {
          errors.push(`${relPath} uses an animate-* utility without motion-reduce: fallback.`);
          break;
        }
      }
    }
    if (relPath.startsWith('app/')) {
      if (relPath.endsWith('.tsx')) {
        const shadow = APP_SHADOW_RE.exec(code);
        if (shadow !== null) {
          errors.push(`${relPath} uses ${shadow[0]}; /app/ is flat with zero box shadows (DESIGN.md).`);
        }
        if (APP_BACKDROP_BLUR_RE.test(code)) {
          errors.push(`${relPath} uses backdrop-blur in JSX; frosted glass is limited to TopContextBar and DitherBanner in tailwind.css (DESIGN.md).`);
        }
      }
      continue;
    }
    const appToken = LANDING_APP_TOKEN_RE.exec(code);
    if (appToken !== null) {
      errors.push(`${relPath} uses /app/-only colour utility ${appToken[0]}; use landing theme tokens (docs/landing.md).`);
    }
    const hex = LANDING_RAW_HEX_RE.exec(code);
    if (hex !== null) {
      errors.push(`${relPath} uses a raw colour ${hex[1]} in a class; use a theme colour token (docs/landing.md).`);
    }
    if (LANDING_ARBITRARY_RADIUS_RE.test(code)) {
      errors.push(`${relPath} uses an arbitrary rounded-[...] radius; landing pages use plain \`rounded\` (docs/landing.md).`);
    }
    if (relPath.endsWith('.tsx') && code.includes(EM_DASH)) {
      errors.push(`${relPath} contains an em dash; landing copy uses commas, colons or full stops (docs/landing.md).`);
    }
  }

  return errors;
}

/** Validates the built web output directory against Macro's layout, CSP, asset isolation and weight budget constraints. */
export async function validateWebDist(outDir: string, budget: WeightBudget = WEIGHT_BUDGET): Promise<string[]> {
  const errors: string[] = [];

  for (const name of REQUIRED_FILES) {
    if (!existsSync(join(outDir, name))) {
      errors.push(`Web build is missing ${name.replace(/\\/g, '/')}.`);
    }
  }

  if (existsSync(join(outDir, 'app-next', 'index.html'))) {
    errors.push('Web build still contains /app-next/; the React app must ship at /app/ only.');
  }

  if (!existsSync(outDir)) return errors;

  const htmlByPath = new Map<string, string>();
  const htmlFiles = await collectFiles(outDir, outDir, (name) => name.endsWith('.html'));
  for (const relPath of htmlFiles) {
    const html = await readFile(join(outDir, relPath), 'utf8');
    htmlByPath.set(relPath, html);
    if (STYLE_TAG_RE.test(html)) {
      errors.push(`${relPath} contains a <style> tag, which the CSP blocks.`);
    }
    const { hasStyleAttr, hasInlineScript } = inspectHtmlTags(html);
    if (hasStyleAttr) {
      errors.push(`${relPath} contains a style attribute, which the CSP blocks.`);
    }
    if (hasInlineScript) {
      errors.push(`${relPath} contains an inline script, which the CSP blocks.`);
    }
  }

  const appHtml = htmlByPath.get('app/index.html');
  const appStylesheets = new Set<string>();
  if (appHtml !== undefined) {
    const appLinks = extractLinkTags(appHtml);
    for (const link of appLinks) {
      if (link.rel.split(/\s+/).includes('stylesheet')) {
        appStylesheets.add(link.href);
      }
    }
    const hasGeistPreload = appLinks.some(
      (link) => link.rel.split(/\s+/).includes('preload') && link.href === GEIST_MONO_FONT,
    );
    if (!hasGeistPreload) {
      errors.push(`app/index.html is missing the ${GEIST_MONO_FONT} preload.`);
    }
  }

  for (const page of LANDING_PAGES) {
    const html = htmlByPath.get(page);
    if (html === undefined) continue;
    for (const link of extractLinkTags(html)) {
      if (appStylesheets.has(link.href) || APP_CSS_HREF_RE.test(link.href)) {
        errors.push(`${page} references an app stylesheet (${link.href}), which must only load in /app/.`);
      }
    }
  }

  const homeHtml = htmlByPath.get('index.html');
  if (homeHtml !== undefined) {
    for (const link of extractLinkTags(homeHtml)) {
      if (!link.rel.split(/\s+/).includes('stylesheet')) continue;
      const cssPath = join(outDir, link.href.replace(/^\//, ''));
      if (!existsSync(cssPath)) continue;
      if (!/\.rounded\s*\{/.test(await readFile(cssPath, 'utf8'))) {
        errors.push(`index.html stylesheet ${link.href} has no .rounded utility, so every landing corner renders square.`);
      }
    }
  }

  errors.push(...(await measureWeightBudget(outDir, budget)).overBudget);
  return errors;
}

/**
 * Weight budget for the landing pages, in raw bytes of the built files, per page:
 * JS is every module script and module preload the page loads, minus chunks /app/ also loads
 * (the shared React runtime); CSS is every stylesheet the page links.
 */
export interface WeightBudget {
  /** Most landing JS a page may load. */
  jsBytes: number;
  /** CSS a page links must stay under this. */
  cssBytes: number;
}

/**
 * JS: 24 KiB, about the landing page's size before the redesign (#13). CSS: under 36 KiB, raised from
 * the spec's 32 KiB in #21 because Tailwind utilities for the four landing pages measure about
 * 35 KiB raw (under 9 KB gzipped); see the #21 report.
 */
export const WEIGHT_BUDGET: WeightBudget = { jsBytes: 24 * 1024, cssBytes: 36 * 1024 };

export interface PageWeight {
  page: string;
  jsBytes: number;
  cssBytes: number;
}

const SCRIPT_TAG_RE = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTR_SRC_VALUE_RE = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ASSET_PREFIX = '/landing/assets/';

function pageAssets(html: string): { js: Set<string>; css: Set<string> } {
  const js = new Set<string>();
  const css = new Set<string>();
  for (const match of html.matchAll(SCRIPT_TAG_RE)) {
    const src = extractAttr(match[1] ?? '', ATTR_SRC_VALUE_RE);
    if (src?.startsWith(ASSET_PREFIX)) js.add(src);
  }
  for (const link of extractLinkTags(html)) {
    const rels = link.rel.split(/\s+/);
    if (!link.href.startsWith(ASSET_PREFIX)) continue;
    if (rels.includes('modulepreload')) js.add(link.href);
    if (rels.includes('stylesheet')) css.add(link.href);
  }
  return { js, css };
}

async function fileBytes(outDir: string, href: string): Promise<number> {
  const file = Bun.file(join(outDir, ...href.split('/').filter(Boolean)));
  return (await file.exists()) ? file.size : 0;
}

/** Measures each landing page against the weight budget; `overBudget` lists the pages that break it. */
export async function measureWeightBudget(
  outDir: string,
  budget: WeightBudget = WEIGHT_BUDGET,
): Promise<{ pages: PageWeight[]; overBudget: string[] }> {
  const appPath = join(outDir, 'app', 'index.html');
  const appJs = existsSync(appPath) ? pageAssets(await readFile(appPath, 'utf8')).js : new Set<string>();
  const pages: PageWeight[] = [];
  const overBudget: string[] = [];

  for (const page of LANDING_PAGES) {
    const path = join(outDir, page);
    if (!existsSync(path)) continue;
    const { js, css } = pageAssets(await readFile(path, 'utf8'));
    let jsBytes = 0;
    for (const href of js) if (!appJs.has(href)) jsBytes += await fileBytes(outDir, href);
    let cssBytes = 0;
    for (const href of css) cssBytes += await fileBytes(outDir, href);
    pages.push({ page, jsBytes, cssBytes });
    if (jsBytes > budget.jsBytes) {
      overBudget.push(`${page} loads ${jsBytes} bytes of landing JS, over the ${budget.jsBytes}-byte budget.`);
    }
    if (cssBytes >= budget.cssBytes) {
      overBudget.push(`${page} links ${cssBytes} bytes of CSS; the budget is under ${budget.cssBytes} bytes.`);
    }
  }

  return { pages, overBudget };
}
