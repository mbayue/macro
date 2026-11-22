import {
  AlertCircleIcon,
  ChevronDownIcon,
  LogOutIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  TablePropertiesIcon,
  UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
      className="shell-glass-bar border-b border-border px-4 py-2.5 min-[861px]:sticky min-[861px]:top-0 min-[861px]:z-20 min-[861px]:px-10 print:hidden"
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="hidden min-[1280px]:inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span>Macro</span>
            <span aria-hidden="true">/</span>
            <span className="max-w-[240px] truncate font-medium text-foreground">{breadcrumb}</span>
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground min-[861px]:sr-only">Target</span>
            <span
              className="max-w-[240px] truncate rounded-sm border border-[var(--ap-line-strong)] bg-surface px-2 py-0.5 font-mono text-xs text-foreground sm:max-w-xs"
              title={state.target.host ?? undefined}
            >
              {state.target.host ?? 'Demo Target'}
            </span>
            <Badge variant={state.target.kind === 'verified' ? 'ok' : 'outline'} className="font-mono">
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

        <div className="hidden min-[861px]:flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="Usage quota"
            className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ap-line-strong)] bg-surface px-2.5 py-1 font-mono text-xs"
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

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={actions.openQuickJump}
            className="border-[var(--ap-line-strong)] bg-surface font-mono text-xs text-foreground hover:bg-secondary"
          >
            <SearchIcon data-icon="inline-start" />
            <span>Quick Jump</span>
            <kbd className="ml-0.5 rounded-sm text-[11px] leading-none text-muted-foreground">
              · {meta.shortcutHint}
            </kbd>
          </Button>

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
                  className="border-[var(--ap-line-strong)] bg-surface text-xs text-foreground hover:bg-secondary"
                />
              }
            >
              {state.theme === 'dark' ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
              <span>{state.theme === 'dark' ? 'Light' : 'Dark'}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </TooltipContent>
          </Tooltip>

          {state.me !== null ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="max-w-[210px] border-[var(--ap-line-strong)] bg-surface text-xs text-foreground hover:bg-secondary"
                  />
                }
              >
                <span className="truncate">{state.identityLabel}</span>
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <span className="block truncate font-medium text-foreground">{state.identityLabel}</span>
                    {state.me.verifiedOrigin ? (
                      <span
                        className="block truncate font-mono text-[11px] text-muted-foreground"
                        title={state.me.verifiedOrigin.host}
                      >
                        {state.me.verifiedOrigin.host}
                      </span>
                    ) : null}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLinkItem href="#/account">
                    <UserIcon />
                    Account
                  </DropdownMenuLinkItem>
                  <DropdownMenuLinkItem href="#/runs">
                    <TablePropertiesIcon />
                    Runs Table
                  </DropdownMenuLinkItem>
                  {state.target.pendingHost !== null ? (
                    <DropdownMenuLinkItem href="#/domains">
                      <AlertCircleIcon />
                      Finish verifying {state.target.pendingHost}
                    </DropdownMenuLinkItem>
                  ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={state.signingOut}
                    onClick={() => void actions.signOut()}
                  >
                    <LogOutIcon />
                    {state.signingOut ? 'Signing out…' : 'Sign out'}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              render={<a href="#/sign-in" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="border-[var(--ap-line-strong)] bg-surface text-xs text-foreground hover:bg-secondary"
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
