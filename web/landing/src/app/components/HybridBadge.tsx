import { SquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InferenceOrigin, OnDeviceAvailability } from '../lib/hybrid-ai.ts';
import { Badge } from './ui.tsx';

/** Displays whether Hybrid Inference ran on-device (Gemini Nano) or in cloud (Gemini). */
export function HybridBadge({ origin }: { origin: InferenceOrigin }) {
  if (origin === 'on-device') return <Badge tone="ok">On-device · Gemini Nano</Badge>;
  if (origin === 'cloud') return <Badge>Cloud · Gemini</Badge>;
  return <Badge>Hybrid AI</Badge>;
}

/** Displays pre-flight Chrome Built-in AI availability before a prompt runs. */
export function HybridAvailabilityBadge({ availability }: { availability: OnDeviceAvailability | null }) {
  if (availability === 'ready') return <Badge tone="ok">On-device ready</Badge>;
  if (availability === 'downloading') return <Badge tone="warn">Gemini Nano downloading</Badge>;
  if (availability === 'cloud-fallback') return <Badge>Cloud fallback</Badge>;
  return null;
}

/** Shared cancel control for cancelling an in-flight Hybrid AI stream. */
export function HybridStopButton({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  if (!busy) return null;
  return (
    <Button type="button" variant="outline" className="border-bar" onClick={onStop}>
      <SquareIcon data-icon="inline-start" />
      Stop
    </Button>
  );
}
