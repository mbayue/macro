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
    if (tagName === 'script' && !ATTR_SRC_RE.test(unquotedAttrs)) {
      hasInlineScript = true;
    }
    if (hasStyleAttr && hasInlineScript) break;
  }

  return { hasStyleAttr, hasInlineScript };
}

async function collectHtmlFiles(dir: string, root: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(fullPath, root)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(relative(root, fullPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

/** Validates the built web output directory against Macro's layout, CSP, and asset isolation constraints. */
export async function validateWebDist(outDir: string): Promise<string[]> {
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
  const htmlFiles = await collectHtmlFiles(outDir, outDir);
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
      if (/geist-mono/i.test(link.href)) {
        errors.push(`${page} references app font (${link.href}), which must only preload/load in /app/.`);
      }
    }
  }

  return errors;
}
