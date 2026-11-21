import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createFirebaseHybridRunner,
  runHybridPrompt,
  type HybridReply,
} from '../lib/hybrid-ai.ts';
import { useApp } from '../context.tsx';

/**
 * Shared React hook for client-side Hybrid Inference panels.
 * Handles lazy runner creation, unmount/sequence guards, and live announcements.
 */
export function useHybridPrompt() {
  const { config, announce } = useApp();
  const firebase = config.firebase ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<HybridReply | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runner = useMemo(
    () => (firebase ? createFirebaseHybridRunner(firebase) : null),
    [firebase],
  );

  async function run(prompt: string, busyAnnouncement: string, readyLabel: string): Promise<void> {
    if (!runner || busy) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    setReply(null);
    announce(busyAnnouncement);
    const onChunk = (streamed: string) => {
      if (!alive.current || mine !== seq.current) return;
      setReply((prev) => ({ text: streamed, origin: prev?.origin ?? 'unknown' }));
    };
    const res = await runHybridPrompt(runner, prompt, onChunk);
    if (!alive.current || mine !== seq.current) return;
    setBusy(false);
    if (res.ok) {
      setReply(res.reply);
      announce(`${readyLabel} (${res.reply.origin}).`);
    } else {
      setError(res.error);
      announce(res.error);
    }
  }

  return {
    available: firebase !== null && runner !== null,
    busy,
    error,
    reply,
    clearReply: () => setReply(null),
    run,
  };
}
