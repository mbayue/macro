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
    <div className="flex flex-wrap items-center gap-2 min-[861px]:justify-end">
      <div
        className="inline-flex w-full flex-wrap items-center gap-0.5 rounded-md border border-[var(--ap-line-strong)] bg-surface p-0.5 min-[640px]:w-auto"
        role="radiogroup"
        aria-label="Target environment"
      >
        <label
          className={cn(
            'relative flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-sm border px-3 py-1 text-xs font-medium select-none transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none min-[640px]:w-auto has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'demo'
              ? 'border-[var(--ap-line-strong)] bg-secondary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
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
          <span>
            Demo Target (<span className="font-mono tabular-nums" translate="no">{demoHost}</span>)
          </span>
        </label>

        <label
          className={cn(
            'relative flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-sm border px-3 py-1 text-xs font-medium select-none transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none min-[640px]:w-auto has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
            targetMode === 'own'
              ? 'border-[var(--ap-line-strong)] bg-secondary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
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
          <span>
            Own Site{' '}
            {verifiedOrigin ? (
              <>
                (<span className="font-mono tabular-nums" translate="no">{verifiedOrigin.host}</span>)
              </>
            ) : (
              '(Verified HTTPS)'
            )}
          </span>
          {verifiedOrigin !== null ? (
            <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" title="Verified origin" />
          ) : null}
        </label>
      </div>

      {targetMode === 'own' ? (
        verifiedOrigin !== null ? (
          <Button
            render={<a href="#/domains" />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="h-9 border-[var(--ap-line-strong)] bg-surface px-2.5 text-xs hover:bg-secondary"
          >
            Manage domain
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : me === null ? (
          <a
            href="#/sign-in"
            className="rounded-sm border border-[var(--ap-line-strong)] bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-secondary"
          >
            Sign in to verify
          </a>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="warn">{pendingHost ? 'Verification pending' : 'Verification required'}</Badge>
            <Button
              render={<a href="#/domains" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="h-8 border-[var(--ap-line-strong)] bg-surface px-2.5 text-xs hover:bg-secondary"
            >
              {pendingHost ? 'Continue verification' : 'Verify a domain'}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
