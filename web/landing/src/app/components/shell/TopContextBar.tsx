import { AlertCircleIcon, UserIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShell } from './ShellContext.tsx';
import { formatQuotaReadout, formatRouteBreadcrumb } from './shell-view.ts';

/** Frosted sticky workspace context bar: breadcrumb, target host + badge, `/api/quota` readout, Quick Jump, theme, and account. */
export function TopContextBar() {
  const { state, actions, meta } = useShell();
  const quota = formatQuotaReadout(state.quota);
  const breadcrumb = formatRouteBreadcrumb(state.route);

  return (
    <div
      data-slot="shell-context-bar"
      className="shell-glass-bar flex min-h-[59px] items-center border-b border-border px-4 py-2.5 min-[861px]:sticky min-[861px]:top-0 min-[861px]:z-20 min-[861px]:px-10 print:hidden"
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-nowrap items-center gap-2.5 overflow-hidden">
          <span className="hidden min-[1280px]:inline-flex min-w-0 items-center gap-1.5 font-mono text-[0.9375rem] text-muted-foreground">
            <span className="shrink-0">Macro</span>
            <span className="shrink-0" aria-hidden="true">/</span>
            <span className="max-w-[200px] truncate font-medium text-foreground">{breadcrumb}</span>
          </span>
          <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2">
            <span className="text-xs text-muted-foreground min-[861px]:sr-only">Target</span>
            <span
              className="inline-flex max-w-[180px] items-center truncate rounded-sm border border-[var(--ap-line-strong)] bg-surface px-2 py-[3px] font-mono text-xs leading-[1.2] text-foreground min-[1440px]:max-w-[240px]"
              title={state.target.host ?? undefined}
            >
              {state.target.host ?? 'Demo Target'}
            </span>
            <Badge variant={state.target.kind === 'verified' ? 'ok' : 'outline'} className="shrink-0 px-2 py-[3px] font-mono text-xs leading-[1.2]">
              {state.target.badgeLabel}
            </Badge>
            {state.target.pendingHost !== null ? (
              <a
                href="#/domains"
                className="inline-flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-warn underline underline-offset-4 hover:opacity-85 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
              >
                <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate" title={state.target.pendingHost}>
                  Finish verifying <span className="font-mono">{state.target.pendingHost}</span>
                </span>
              </a>
            ) : null}
          </div>
        </div>

        <div className="hidden min-[861px]:flex shrink-0 items-center gap-2.5">
          <div
            role="group"
            aria-label="Usage quota"
            className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ap-line-strong)] bg-surface px-2 py-[3px] font-mono text-xs leading-[1.2]"
          >
            {quota !== null ? (
              <>
                <span className="text-muted-foreground">Plans left</span>
                <span className="text-foreground tabular-nums">{quota.planning}</span>
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted-foreground">Runs left</span>
                <span className="text-foreground tabular-nums">{quota.dailyRuns}</span>
                {quota.scopeLabel !== null ? (
                  <>
                    <span className="text-muted-foreground" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-muted-foreground">{quota.scopeLabel}</span>
                  </>
                ) : null}
              </>
            ) : state.quotaLoading ? (
              <span className="text-muted-foreground">Loading quota…</span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={actions.openQuickJump}
            className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-md border border-[var(--ap-line-strong)] bg-surface px-3 font-mono text-xs leading-[1.2] text-foreground transition-[background-color,transform] duration-150 hover:bg-secondary active:scale-[0.97] focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring motion-reduce:transition-none"
          >
            <span>Quick Jump · {meta.shortcutHint}</span>
          </button>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={actions.toggleTheme}
                  aria-label={state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  aria-pressed={state.theme === 'dark'}
                  className="h-[34px] rounded-md border-[var(--ap-line-strong)] bg-surface px-3 font-sans text-[0.8125rem] font-medium text-foreground hover:bg-secondary"
                />
              }
            >
              {state.theme === 'dark' ? 'Light' : 'Dark'}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </TooltipContent>
          </Tooltip>

          {state.me !== null ? (
            <span
              className="inline-flex h-[34px] max-w-[220px] items-center rounded-md border border-[var(--ap-line-strong)] bg-surface px-3 font-sans text-[0.8125rem] font-medium text-foreground"
              title={state.identityLabel ?? undefined}
            >
              <span className="truncate">{state.identityLabel}</span>
            </span>
          ) : (
            <Button
              render={<a href="#/sign-in" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="h-[34px] rounded-md border-[var(--ap-line-strong)] bg-surface px-3 font-sans text-[0.8125rem] font-medium text-foreground hover:bg-secondary"
            >
              <UserIcon data-icon="inline-start" />
              Sign in
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
