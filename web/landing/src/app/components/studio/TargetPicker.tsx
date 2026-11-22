import { ArrowRightIcon, GlobeIcon, StoreIcon } from 'lucide-react';
import type { MeResponse } from '../../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TargetMode } from './studio-view.ts';

export interface TargetPickerProps {
  targetMode: TargetMode;
  webOrigin: string;
  me: MeResponse | null;
  verifiedOrigin: { origin: string; host: string } | null;
  disabled: boolean;
  onChooseTarget: (mode: TargetMode) => void;
}

/** Compact header-aligned target environment switcher (`Demo Target` vs `Own Site`) linking to `#/domains`. */
export function TargetPicker({
  targetMode,
  webOrigin,
  me,
  verifiedOrigin,
  disabled,
  onChooseTarget,
}: TargetPickerProps) {
  const pendingHost = me?.pendingVerification?.host ?? null;
  const demoHost = webOrigin.replace(/^https?:\/\//, '');

  return (
    <div className="flex flex-col items-start gap-2 min-[861px]:items-end">
      <div
        className="inline-flex w-full flex-wrap items-center gap-0.5 rounded-md border border-[var(--ap-line-strong)] bg-surface p-0.5 min-[640px]:w-auto"
        role="radiogroup"
        aria-label="Target environment"
      >
        <label
          className={cn(
            'relative flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium select-none transition-[background-color,color] duration-150 motion-reduce:transition-none min-[640px]:w-auto has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'demo'
              ? 'bg-secondary text-foreground shadow-[inset_0_0_0_1px_var(--ap-line-strong)]'
              : 'text-muted-foreground hover:text-foreground',
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
          <span>Demo Target ({demoHost})</span>
        </label>

        <label
          className={cn(
            'relative flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium select-none transition-[background-color,color] duration-150 motion-reduce:transition-none min-[640px]:w-auto has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'own'
              ? 'bg-secondary text-foreground shadow-[inset_0_0_0_1px_var(--ap-line-strong)]'
              : 'text-muted-foreground hover:text-foreground',
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
          <span>Own Site {verifiedOrigin ? `(${verifiedOrigin.host})` : '(Verified HTTPS)'}</span>
          {verifiedOrigin !== null ? (
            <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" title="Verified origin" />
          ) : null}
        </label>
      </div>

      {targetMode === 'own' ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
          {verifiedOrigin !== null ? (
            <>
              <span className="font-mono text-foreground break-all">{verifiedOrigin.origin}</span>
              <Badge variant="ok">Verified</Badge>
              <Button render={<a href="#/domains" />} nativeButton={false} variant="secondary" size="sm" className="h-7 px-2.5 text-xs">
                Manage domain
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
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
              <Badge variant="warn">{pendingHost ? 'Verification pending' : 'Verification required'}</Badge>
              <span className={pendingHost ? 'text-muted-foreground' : 'text-bad'}>
                {pendingHost ? (
                  <>
                    Finish verifying <span className="font-mono text-foreground">{pendingHost}</span>.
                  </>
                ) : (
                  'Domain verification required before drafting.'
                )}
              </span>
              <Button render={<a href="#/domains" />} nativeButton={false} variant="secondary" size="sm" className="h-7 px-2.5 text-xs">
                {pendingHost ? 'Continue verification' : 'Verify a domain'}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
