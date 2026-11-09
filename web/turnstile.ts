/**
 * Cloudflare Turnstile helper (explicit render, one widget at a time).
 *
 *   const token = await getToken(siteKey, container); // may show a challenge in `container`
 *   ... send the token ...
 *   resetWidget();                                    // always, so a token is never reused
 *
 * The widget is rendered with `execution: 'execute'` and `appearance:
 * 'interaction-only'`: nothing is visible unless Cloudflare needs the user.
 * The script is loaded once from challenges.cloudflare.com (allowed by the CSP).
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileRenderOptions {
  sitekey: string;
  execution?: 'render' | 'execute';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => boolean | void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'unsupported-callback'?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  execute(widget: string | HTMLElement): void;
  reset(widget?: string): void;
  remove(widget?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface Inflight {
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

let scriptPromise: Promise<TurnstileApi> | null = null;
let widgetId: string | null = null;
let widgetContainer: HTMLElement | null = null;
let widgetSiteKey = '';
let inflight: Inflight | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;
  const p = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not initialise'));
    };
    s.onerror = () => {
      s.remove();
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(s);
  });
  scriptPromise = p;
  p.catch(() => {
    if (scriptPromise === p) scriptPromise = null; // allow a retry
  });
  return p;
}

function failInflight(message: string): void {
  inflight?.reject(new Error(message));
}

function removeWidget(api: TurnstileApi | undefined): void {
  if (widgetId !== null && api) {
    try {
      api.remove(widgetId);
    } catch {
      // The widget may already be gone with its container.
    }
  }
  widgetId = null;
  widgetContainer = null;
  widgetSiteKey = '';
}

async function start(siteKey: string, container: HTMLElement): Promise<void> {
  const api = await loadScript();
  if (
    widgetId !== null &&
    (widgetContainer !== container || widgetSiteKey !== siteKey || !container.isConnected)
  ) {
    removeWidget(api);
  }
  if (widgetId !== null) {
    api.reset(widgetId);
    api.execute(widgetId);
    return;
  }
  const id = api.render(container, {
    sitekey: siteKey,
    execution: 'execute',
    appearance: 'interaction-only',
    callback: (token) => inflight?.resolve(token),
    'error-callback': () => failInflight('Turnstile reported an error'),
    'expired-callback': () => failInflight('Turnstile token expired'),
    'timeout-callback': () => failInflight('Turnstile challenge timed out'),
    'unsupported-callback': () => failInflight('Turnstile is not supported in this browser'),
  });
  if (id === undefined) throw new Error('Turnstile could not render');
  widgetId = id;
  widgetContainer = container;
  widgetSiteKey = siteKey;
  api.execute(id);
}

/**
 * Get a fresh single-use token. A second call while one is in flight returns
 * the same promise. Rejects if the script cannot load or the challenge fails.
 */
export function getToken(siteKey: string, container: HTMLElement): Promise<string> {
  if (inflight) return inflight.promise;
  let resolve!: (token: string) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const current: Inflight = { promise, resolve, reject };
  inflight = current;
  const release = (): void => {
    if (inflight === current) inflight = null;
  };
  promise.then(release, release);
  start(siteKey, container).catch((err: unknown) => {
    current.reject(err instanceof Error ? err : new Error('Turnstile failed'));
  });
  return promise;
}

/** Discard the widget's current token. Call after every use. */
export function resetWidget(): void {
  if (widgetId === null || !window.turnstile) return;
  try {
    window.turnstile.reset(widgetId);
  } catch {
    // Ignore: the next getToken call re-renders if needed.
  }
}

/** Remove the widget entirely (a view is going away). Rejects a pending getToken. */
export function disposeWidget(): void {
  failInflight('Turnstile widget disposed');
  removeWidget(window.turnstile);
}

/**
 * Remove the widget only if it lives in `container` (a part of a view is going away). A widget
 * another part of the page has moved elsewhere, and its pending token, are left alone.
 */
export function disposeWidgetIn(container: HTMLElement | null): void {
  if (container === null || widgetContainer !== container) return;
  disposeWidget();
}
