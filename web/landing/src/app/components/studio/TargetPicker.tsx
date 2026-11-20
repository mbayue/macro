import { ArrowDownIcon, GlobeIcon, StoreIcon } from 'lucide-react';
import type { MeResponse } from '../../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../ui.tsx';
import { VerifyPanel } from '../VerifyPanel.tsx';
import type { TargetMode } from './studio-view.ts';
import { TelemetryPanel } from './TelemetryFrame.tsx';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface TargetPickerProps {
  targetMode: TargetMode;
  webOrigin: string;
  me: MeResponse | null;
  verifiedOrigin: { origin: string; host: string } | null;
  showVerify: boolean;
  disabled: boolean;
  onChooseTarget: (mode: TargetMode) => void;
  onClearVerifiedOrigin: () => void;
}

/** Target environment selector (`Demo Target` vs `Own Site`) with inline domain verification when needed. */
export function TargetPicker({
  targetMode,
  webOrigin,
  me,
  verifiedOrigin,
  showVerify,
  disabled,
  onChooseTarget,
  onClearVerifiedOrigin,
}: TargetPickerProps) {
  const scrollToVerify = () => {
    const panel = document.getElementById('verify-panel');
    panel?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    panel?.querySelector<HTMLInputElement>('input[name="host"]')?.focus();
  };

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="target-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="target-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Target environment
        </h2>
        <Badge variant={targetMode === 'own' && verifiedOrigin !== null ? 'ok' : 'outline'}>
          {targetMode === 'demo' ? 'Demo Target' : verifiedOrigin !== null ? 'Verified Own Site' : 'Own Site'}
        </Badge>
      </div>

      <div
        className="inline-grid w-full max-w-[300px] grid-cols-2 gap-0.5 rounded-md border border-bar-hover bg-secondary p-0.5"
        role="radiogroup"
        aria-labelledby="target-heading"
      >
        <label
          className={cn(
            'relative flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium select-none transition-[background-color,color] duration-150 motion-reduce:transition-none has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'demo' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <input
            type="radio"
            name="target-mode"
            value="demo"
            checked={targetMode === 'demo'}
            onChange={() => onChooseTarget('demo')}
            disabled={disabled}
            className="sr-only"
          />
          <StoreIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Demo Target</span>
        </label>

        <label
          className={cn(
            'relative flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium select-none transition-[background-color,color] duration-150 motion-reduce:transition-none has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'own' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <input
            type="radio"
            name="target-mode"
            value="own"
            checked={targetMode === 'own'}
            onChange={() => onChooseTarget('own')}
            disabled={disabled}
            className="sr-only"
          />
          <GlobeIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Own Site</span>
          {verifiedOrigin !== null ? (
            <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" title="Verified origin" />
          ) : null}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        {targetMode === 'demo' ? (
          <>
            <span className="font-mono text-foreground break-all">{webOrigin}</span>
            <span className="text-muted-foreground">Public demo shop. Reports stay public.</span>
          </>
        ) : verifiedOrigin !== null ? (
          <>
            <span className="font-mono text-foreground break-all">{verifiedOrigin.origin}</span>
            <Badge variant="ok">Verified</Badge>
            <ConfirmButton
              label="Change"
              confirmLabel="Clear verified site"
              cancelLabel="Keep"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              confirmClassName={buttonVariants({ variant: 'destructive', size: 'sm' })}
              cancelClassName={buttonVariants({ variant: 'secondary', size: 'sm' })}
              disabled={disabled}
              onConfirm={onClearVerifiedOrigin}
            />
          </>
        ) : me === null ? (
          <span className="text-muted-foreground">
            <a href="#/sign-in" className="text-foreground underline underline-offset-4 hover:text-accent-text">
              Sign in
            </a>{' '}
            to verify your site and run private own-site tests.
          </span>
        ) : (
          <>
            <Badge variant="warn">Verification required</Badge>
            <span className="text-bad">Domain verification required before drafting.</span>
            <Button type="button" variant="link" size="xs" onClick={scrollToVerify}>
              See verification panel
              <ArrowDownIcon data-icon="inline-end" />
            </Button>
          </>
        )}
      </div>

      {targetMode === 'own' ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Macro reads <span className="font-mono text-foreground">/</span> on your site, then the scripts that page links, and uses those files as the journey. It does not run the page.
        </p>
      ) : null}

      {showVerify ? (
        <div id="verify-panel" className="scroll-mt-20 pt-1">
          <VerifyPanel initialHost="" />
        </div>
      ) : null}
    </TelemetryPanel>
  );
}
