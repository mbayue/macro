/**
 * Cloudflare Turnstile through the existing single-widget helper (web/turnstile.ts).
 * `useTurnstile` gives a container ref to render where the challenge may appear and a
 * `token()` that resolves a fresh single-use token; the widget is reset after every use
 * and disposed when the screen goes away.
 */
import { useCallback, useEffect, useRef } from 'react';
import { disposeWidgetIn, getToken, resetWidget } from '../lib/turnstile.ts';
import { useApp } from '../context.tsx';

export function useTurnstile() {
  const { config } = useApp();
  const box = useRef<HTMLDivElement>(null);

  // Only this slot's own widget goes away with it: another slot may be waiting for a token.
  useEffect(() => {
    const el = box.current;
    return () => disposeWidgetIn(el);
  }, []);

  const token = useCallback(async (): Promise<string> => {
    if (!box.current) throw new Error('Turnstile container is not mounted');
    return getToken(config.turnstileSiteKey, box.current);
  }, [config.turnstileSiteKey]);

  return { box, token, reset: resetWidget };
}

/** Where the challenge renders when Cloudflare needs an interaction; empty most of the time. */
export function TurnstileBox({ boxRef }: { boxRef: React.RefObject<HTMLDivElement | null> }) {
  return <div className="turnstile" ref={boxRef} />;
}
