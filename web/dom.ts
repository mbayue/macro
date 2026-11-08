/**
 * DOM helpers for the Web_UI.
 *
 * Rule: every string that comes from the API (plan names, rationale, error
 * messages, reasons) reaches the page as a text node. `el` turns string and
 * number children into text nodes and refuses attributes that could carry
 * markup, inline styles, or inline handlers (the CSP forbids them anyway).
 */
import type { ApiErrorBody, ParseErrorView, PolicyViolationView } from '../src/api-types.ts';

export type Child = Node | string | number | null | undefined | false;
export type ChildArg = Child | Child[];
export type Handler = (ev: Event) => void;
export type AttrValue = string | number | boolean | null | undefined | Handler;
export type Attrs = Record<string, AttrValue>;

const FORBIDDEN_ATTRS = new Set(['style', 'innerhtml', 'outerhtml', 'srcdoc']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const SAFE_URL = /^(#|\/(?!\/)|https:\/\/)/i;

function applyAttrs(node: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    const lower = key.toLowerCase();
    if (FORBIDDEN_ATTRS.has(lower)) {
      throw new Error(`Attribute "${key}" is not allowed`);
    }
    if (lower.startsWith('on')) {
      if (typeof value !== 'function') {
        throw new Error(`Attribute "${key}" must be a function`);
      }
      node.addEventListener(lower.slice(2), value);
      continue;
    }
    if (typeof value === 'function') {
      throw new Error(`Attribute "${key}" must not be a function`);
    }
    if (URL_ATTRS.has(lower) && typeof value === 'string' && !SAFE_URL.test(value)) {
      throw new Error(`Attribute "${key}" has an unsafe URL`);
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
}

function appendChildren(node: Node, children: ChildArg[]): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      appendChildren(node, child);
    } else if (child === null || child === undefined || child === false) {
      continue;
    } else if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else if (typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
}

/**
 * Build an HTML element. `class` is a plain attribute name. Keys starting with
 * `on` take a function (`onclick`). `true` sets a boolean attribute; `false`,
 * `null` and `undefined` skip it. Strings and numbers become text nodes.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: ChildArg[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Same as `el`, for SVG elements (charts). Text children are text nodes. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: ChildArg[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** Remove all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Wrap a wide table so it scrolls sideways on narrow screens. The wrapper is
 * focusable so keyboard users can scroll it.
 */
export function scrollRegion(label: string, child: Node): HTMLElement {
  return el('div', { class: 'table-wrap', role: 'region', 'aria-label': label, tabindex: 0 }, child);
}

/** `2026-05-21 14:03:07 UTC` for an epoch-ms value. */
export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Plain-text description of a parse error: reason plus path or offset. */
export function parseErrorText(pe: ParseErrorView): string {
  let text = pe.reason;
  if (pe.path !== undefined && pe.path !== '') text += ` (at ${pe.path})`;
  if (pe.offset !== undefined) text += ` (at character offset ${pe.offset})`;
  return text;
}

/** Table of Policy_Gate violations: rule, field path, message. */
export function violationsTable(violations: readonly PolicyViolationView[]): HTMLElement {
  const table = el(
    'table',
    { class: 'table' },
    el('caption', null, 'Policy violations'),
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        el('th', { scope: 'col' }, 'Rule'),
        el('th', { scope: 'col' }, 'Field'),
        el('th', { scope: 'col' }, 'Problem'),
      ),
    ),
    el(
      'tbody',
      null,
      violations.map((v) =>
        el(
          'tr',
          null,
          el('th', { scope: 'row', class: 'mono' }, v.rule),
          el('td', { class: 'mono' }, v.path === '' ? '(whole plan)' : v.path),
          el('td', null, v.message),
        ),
      ),
    ),
  );
  return scrollRegion('Policy violations', table);
}

/**
 * Render an API error for an `role="alert"` region: the fixed message, then
 * whatever extra fields the error carries (retry time, active run link,
 * violations, parse error).
 */
export function renderApiError(err: ApiErrorBody['error']): HTMLElement {
  const box = el('div', { class: 'stack stack--tight' }, el('p', { class: 'alert__message' }, err.message));
  if (err.code === 'rate_limited' && err.retryAt !== undefined) {
    box.append(el('p', null, `You can try again after ${fmtUtc(err.retryAt)}.`));
  }
  if (err.code === 'daily_limit' && err.resetAt !== undefined) {
    box.append(el('p', null, `The daily limit resets at ${fmtUtc(err.resetAt)}.`));
  }
  if (err.code === 'run_active' && err.activeRunId !== undefined) {
    box.append(
      el(
        'p',
        null,
        el('a', { href: `#/run/${encodeURIComponent(err.activeRunId)}` }, 'Open the active run'),
        '.',
      ),
    );
  }
  if (err.parseError) {
    box.append(el('p', null, `Plan could not be read: ${parseErrorText(err.parseError)}`));
  }
  if (err.violations && err.violations.length > 0) {
    box.append(violationsTable(err.violations));
  }
  return box;
}
