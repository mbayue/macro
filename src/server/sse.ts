import type { Handler, ServerContext } from './context.ts';
import { ID_RE, apiError, notFound, safeDecode, toEventView } from './http.ts';

export const SSE_POLL_MS = 5000;
export const SSE_HEARTBEAT_MS = 3000;
/** A terminal Run whose controller task is still busy (AI report) keeps its streams open this long. */
export const SSE_TERMINAL_GRACE_MS = 180_000;
export const SSE_MAX_LIFETIME_MS = 30 * 60_000;
export const SSE_MAX_PER_IP = 8;
export const SSE_MAX_TOTAL = 64;

export interface SseConfig {
  pollMs: number;
  heartbeatMs: number;
  terminalGraceMs: number;
  maxLifetimeMs: number;
  maxPerIp: number;
  maxTotal: number;
}

/** Creates the `/api/runs/:id/events` SSE handler with per-IP and total slot tracking. */
export function createSseHandler(ctx: ServerContext, sseCfg: SseConfig): Handler {
  let activeSseTotal = 0;
  const activeSseByIp = new Map<string, number>();

  return ({ req, ip, server, params }) => {
    const id = safeDecode(params[0] ?? '');
    if (id === null || !ID_RE.test(id)) return notFound();
    const run = ctx.store.getRun(id);
    if (run === null || !ctx.canViewRun(run, req)) return notFound();
    const controller = ctx.controllerFor(run.kind);

    const ipCount = activeSseByIp.get(ip) ?? 0;
    if (activeSseTotal >= sseCfg.maxTotal || ipCount >= sseCfg.maxPerIp) {
      return apiError(429, 'rate_limited', 'Too many open event streams. Try again in a moment.');
    }

    server?.timeout(req, 0);

    const header = req.headers.get('last-event-id')?.trim();
    const lastId = header !== undefined && /^\d{1,15}$/.test(header) ? Number(header) : 0;

    let terminalSince: number | null = null;
    /** Terminal, its controller task (report + AI) over, or the grace period for that task is used up. */
    const isFinished = (): boolean => {
      const current = ctx.store.getRun(id);
      if (current === null) return true;
      if (current.status === 'queued' || current.status === 'running') {
        terminalSince = null;
        return false;
      }
      terminalSince ??= ctx.now();
      return !controller.isRunning(id) || ctx.now() - terminalSince > sseCfg.terminalGraceMs;
    };

    // A reconnect after the end of a finished Run: 204 tells EventSource to stop reconnecting.
    if (lastId > 0 && isFinished() && ctx.store.readEventsAfter(id, lastId, 1).length === 0) {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }

    activeSseTotal += 1;
    activeSseByIp.set(ip, ipCount + 1);
    let released = false;
    const releaseSseSlot = (): void => {
      if (released) return;
      released = true;
      activeSseTotal = Math.max(0, activeSseTotal - 1);
      const cur = activeSseByIp.get(ip) ?? 0;
      if (cur <= 1) activeSseByIp.delete(ip);
      else activeSseByIp.set(ip, cur - 1);
    };

    const encoder = new TextEncoder();
    const startedAt = ctx.now();
    let cleanup = (): void => {
      releaseSseSlot();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        let closed = false;
        const cancels: (() => void)[] = [];
        cleanup = (): void => {
          if (closed) return;
          closed = true;
          releaseSseSlot();
          for (const c of cancels) c();
          cancels.length = 0;
          req.signal.removeEventListener('abort', cleanup);
          try {
            ctl.close();
          } catch {
            // Already closed by the client.
          }
        };
        const send = (text: string): void => {
          if (closed) return;
          try {
            ctl.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };

        let cursor = lastId;
        const tick = (): void => {
          if (closed) return;
          try {
            // Decide "finished" BEFORE reading, so rows written just before the end are still delivered.
            const finished = isFinished();
            let sent = 0;
            for (;;) {
              const rows = ctx.store.readEventsAfter(id, cursor, 200);
              for (const e of rows) {
                send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(toEventView(e))}\n\n`);
                cursor = e.id;
              }
              sent += rows.length;
              if (rows.length < 200) break;
            }
            if (finished || ctx.now() - startedAt > sseCfg.maxLifetimeMs) cleanup();
          } catch (err) {
            ctx.logInternal('sse', err);
            cleanup();
          }
        };

        req.signal.addEventListener('abort', cleanup, { once: true });
        send('retry: 3000\n\n');
        cancels.push(ctx.store.onRunUpdate(id, tick));
        tick();
        if (closed) return;
        cancels.push(ctx.clock.every(tick, sseCfg.pollMs));
        cancels.push(ctx.clock.every(() => send(': hb\n\n'), sseCfg.heartbeatMs));
        if (req.signal.aborted) cleanup();
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  };
}
