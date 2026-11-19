import type { InferenceOrigin } from '../lib/hybrid-ai.ts';
import { Badge } from './ui.tsx';

/** Displays whether Hybrid Inference ran on-device (Gemini Nano) or in cloud (Gemini). */
export function HybridBadge({ origin }: { origin: InferenceOrigin }) {
  if (origin === 'on-device') return <Badge tone="ok">On-device · Gemini Nano</Badge>;
  if (origin === 'cloud') return <Badge tone="live">Cloud · Gemini</Badge>;
  return <Badge>Hybrid AI</Badge>;
}
