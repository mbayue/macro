import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createFirebaseHybridRunner,
  detectOnDeviceAvailability,
  runHybridPrompt,
  type HybridReply,
  type OnDeviceAvailability,
} from '../lib/hybrid-ai.ts';
import { useApp } from '../context.tsx';

/**
 * Shared React hook for client-side Hybrid Inference panels.
 * Handles lazy runner creation, pre-flight availability detection, cancellation, and live announcements.
 */
export function useHybridPrompt() {
  const { config, announce } = useApp();
  const firebase = config.firebase ?? null;
  const [availability, setAvailability] = useState<OnDeviceAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<HybridReply | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (firebase === null) return;
    let cancelled = false;
    void detectOnDeviceAvailability().then((status) => {
      if (!cancelled && alive.current) setAvailability(status);
    });
    return () => {
      cancelled = true;
    };
  }, [firebase]);

  const runner = useMemo(
    () => (firebase ? createFirebaseHybridRunner(firebase) : null),
    [firebase],
  );

  function stop(): void {
    if (!busy) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    announce('Stopped.');
  }

  async function run(prompt: string, busyAnnouncement: string, readyLabel: string): Promise<void> {
    if (!runner || busy) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setCompleted(false);
    setError(null);
    setReply(null);
    announce(busyAnnouncement);
    const onChunk = (streamed: string) => {
      if (!alive.current || mine !== seq.current || controller.signal.aborted) return;
      setReply((prev) => ({ text: streamed, origin: prev?.origin ?? 'unknown' }));
    };
    const res = await runHybridPrompt(runner, prompt, onChunk, controller.signal);
    if (!alive.current || mine !== seq.current) return;
    if (abortRef.current === controller) abortRef.current = null;
    setBusy(false);
    if (res.ok) {
      setReply(res.reply);
      setCompleted(true);
      announce(`${readyLabel} (${res.reply.origin}).`);
    } else if (!res.aborted) {
      setError(res.error);
      announce(res.error);
    }
  }

  return {
    available: firebase !== null && runner !== null,
    availability,
    busy,
    completed,
    error,
    reply,
    clearReply: () => {
      setReply(null);
      setCompleted(false);
    },
    run,
    stop,
  };
}
