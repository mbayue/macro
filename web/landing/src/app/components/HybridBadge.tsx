import { SquareIcon } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatCloudModelLabel,
  type HybridAvailability,
  type HybridReply,
  type InferenceOrigin,
} from '../lib/hybrid-ai.ts';

const TAG_CLASS = 'px-2 py-[3px] font-mono text-xs leading-[1.2]';

/** Displays whether Hybrid Inference ran on-device (Gemini Nano) or in cloud (Gemini). */
export function HybridBadge({ origin, cloudModel }: { origin: InferenceOrigin; cloudModel?: string | undefined }) {
  if (origin === 'on-device') return <UiBadge variant="ok" className={TAG_CLASS}>On-Device Model: Gemini Nano</UiBadge>;
  if (origin === 'cloud') {
    return <UiBadge variant="ok" className={TAG_CLASS}>Cloud Model: {formatCloudModelLabel(cloudModel)}</UiBadge>;
  }
  return <UiBadge variant="outline" className={TAG_CLASS}>Hybrid AI</UiBadge>;
}

/** Displays pre-flight Chrome Built-in AI availability before a prompt runs. */
export function HybridAvailabilityBadge({
  availability,
  cloudModel,
}: {
  availability: HybridAvailability | null;
  cloudModel?: string | undefined;
}) {
  if (availability === 'ready') return <UiBadge variant="ok" className={TAG_CLASS}>On-Device Model: Gemini Nano</UiBadge>;
  if (availability === 'downloading') return <UiBadge variant="warn" className={TAG_CLASS}>Gemini Nano downloading</UiBadge>;
  if (availability === 'on-device-unavailable') {
    return <UiBadge variant="warn" className={TAG_CLASS}>On-Device Only: Unavailable</UiBadge>;
  }
  if (availability === 'cloud-fallback') {
    return <UiBadge variant="ok" className={TAG_CLASS}>Cloud Model: {formatCloudModelLabel(cloudModel)}</UiBadge>;
  }
  return null;
}

/** Displays the active reply origin when a reply exists, or pre-flight availability otherwise. */
export function HybridStatusBadge({
  reply,
  availability,
  cloudModel,
}: {
  reply: Pick<HybridReply, 'origin'> | null;
  availability: HybridAvailability | null;
  cloudModel?: string | undefined;
}) {
  if (reply) return <HybridBadge origin={reply.origin} cloudModel={cloudModel} />;
  return <HybridAvailabilityBadge availability={availability} cloudModel={cloudModel} />;
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
