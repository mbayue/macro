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
import { formatQuotaReadout } from './shell-view.ts';

/** Sticky workspace context bar: target host + badge, `/api/quota` readout, Quick Jump, theme, and account. */
export function TopContextBar() {
  const { state, actions, meta } = useShell();
  const quota = formatQuotaReadout(state.quota);

  return (
    <div
      data-slot="shell-context-bar"
      className="border-b border-border bg-surface px-4 py-2 min-[861px]:sticky min-[861px]:top-0 min-[861px]:z-20 min-[861px]:px-10 min-[861px]:py-2.5 print:hidden"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">Target</span>
            <span
              className="max-w-[240px] truncate font-mono text-xs text-foreground sm:max-w-xs"
              title={state.target.host ?? undefined}
            >
              {state.target.host ?? 'Demo shop'}
            </span>
            <Badge variant={state.target.kind === 'verified' ? 'ok' : 'outline'}>
              {state.target.badgeLabel}
            </Badge>
            {state.target.pendingHost !== null ? (
              <a
                href="#/verify-panel"
                className="inline-flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-warn underline underline-offset-4 hover:opacity-85 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
              >
                <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate" title={state.target.pendingHost}>
                  Finish verifying <span className="font-mono">{state.target.pendingHost}</span>
                </span>
              </a>
            ) : null}
          </div>

          <div
            role="group"
            aria-label="Usage quota"
            className="hidden min-[861px]:inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs"
          >
            {quota !== null ? (
              <>
                <span className="text-muted-foreground">Plans left</span>
                <span className="font-mono text-foreground tabular-nums">{quota.planning}</span>
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted-foreground">Runs left</span>
                <span className="font-mono text-foreground tabular-nums">{quota.dailyRuns}</span>
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
        </div>

        <div className="hidden min-[861px]:flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={actions.openQuickJump}
            className="border-bar bg-background text-muted-foreground hover:text-foreground"
          >
            <SearchIcon data-icon="inline-start" />
            <span>Quick Jump</span>
            <kbd className="ml-1 rounded-sm border border-bar bg-surface px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">
              {meta.shortcutHint}
            </kbd>
          </Button>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={actions.toggleTheme}
                  aria-label={state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  aria-pressed={state.theme === 'dark'}
                  className="border-bar bg-background"
                />
              }
            >
              {state.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
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
                    className="max-w-[210px] border-bar bg-background"
                  />
                }
              >
                <span
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-secondary font-mono text-[11px] font-medium text-foreground"
                  aria-hidden="true"
                >
                  {(state.identityLabel ?? 'U').slice(0, 1).toUpperCase()}
                </span>
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
                    <DropdownMenuLinkItem href="#/verify-panel">
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
              className="border-bar bg-background"
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
