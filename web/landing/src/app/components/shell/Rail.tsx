import type { MouseEvent } from 'react';
import {
  AlertCircleIcon,
  InfoIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TablePropertiesIcon,
  UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark.tsx';
import { useShell } from './ShellContext.tsx';
import { isNavRouteActive, type NavRouteId } from './shell-view.ts';

interface NavItem {
  id: NavRouteId;
  label: string;
  href: string;
  icon: typeof SlidersHorizontalIcon;
}

function useNavItems(): NavItem[] {
  const { state } = useShell();
  return [
    { id: 'new', label: 'Test Studio', href: '#/', icon: SlidersHorizontalIcon },
    { id: 'runs', label: 'Runs Table', href: '#/runs', icon: TablePropertiesIcon },
    { id: 'probe', label: 'Containment Probe', href: '#/probe', icon: ShieldCheckIcon },
    { id: 'account', label: 'Account', href: state.me !== null ? '#/account' : '#/sign-in', icon: UserIcon },
  ];
}

function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** Desktop collapsible sidebar rail (`> 860px`). */
export function DesktopRail() {
  const { state, actions } = useShell();
  const navItems = useNavItems();
  const collapsed = state.railCollapsed;

  const onNewTestClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    actions.navigateTo('/');
  };

  return (
    <aside
      data-slot="shell-rail"
      className={cn(
        'hidden min-[861px]:flex sticky top-0 h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 motion-reduce:transition-none print:hidden',
        collapsed ? 'w-16 items-center px-3 py-4' : 'w-[240px] px-3.5 py-5',
      )}
    >
      <div
        className={cn(
          'flex w-full shrink-0 items-center',
          collapsed ? 'flex-col gap-2 pb-3' : 'justify-between gap-2 pb-4',
        )}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href="#/"
                  aria-label="Macro — Test Studio"
                  className="inline-flex size-10 items-center justify-center rounded-md no-underline hover:bg-secondary focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring"
                />
              }
            >
              <BrandMark />
            </TooltipTrigger>
            <TooltipContent side="right">Macro — Test Studio</TooltipContent>
          </Tooltip>
        ) : (
          <a
            href="#/"
            className="inline-flex items-center gap-2.5 rounded-md px-1.5 py-1 font-display text-[1.375rem] leading-none font-medium tracking-[-0.02em] text-foreground no-underline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring"
          >
            <BrandMark />
            <span>Macro</span>
          </a>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={actions.toggleRailCollapsed}
                aria-label={collapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
                aria-expanded={!collapsed}
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? 'Expand rail' : 'Collapse rail'}</TooltipContent>
        </Tooltip>
      </div>

      <div className={cn('mb-3 w-full', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href="#/"
                  aria-label="New test"
                  onClick={onNewTestClick}
                  className={cn(buttonVariants({ variant: 'default', size: 'icon' }))}
                />
              }
            >
              <PlusIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">New test</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            render={<a href="#/" onClick={onNewTestClick} />}
            nativeButton={false}
            variant="default"
            className="w-full justify-start"
          >
            <PlusIcon data-icon="inline-start" />
            New test
          </Button>
        )}
      </div>

      <nav aria-label="App" className="w-full flex-1 overflow-y-auto">
        <ul className={cn('m-0 flex list-none flex-col gap-1 p-0', collapsed && 'items-center')}>
          {navItems.map((item) => {
            const active = isNavRouteActive(item.id, state.route);
            const Icon = item.icon;
            const linkClass = cn(
              'relative flex items-center rounded-md text-[0.8125rem] font-medium no-underline transition-[background-color,color] duration-150 motion-reduce:transition-none focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring',
              collapsed ? 'size-10 justify-center px-0' : 'min-h-10 gap-2.5 px-2.5',
              active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            );

            if (collapsed) {
              return (
                <li key={item.id}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <a
                          href={item.href}
                          aria-label={item.label}
                          aria-current={active ? 'page' : undefined}
                          className={linkClass}
                        />
                      }
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </li>
              );
            }

            return (
              <li key={item.id}>
                <a href={item.href} aria-current={active ? 'page' : undefined} className={linkClass}>
                  {active ? (
                    <span className="h-4 w-0.5 shrink-0 rounded-xs bg-accent-text" aria-hidden="true" />
                  ) : null}
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn('mt-auto w-full border-t border-border pt-3', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href="/"
                  aria-label="About Macro"
                  className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground no-underline hover:bg-secondary hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                />
              }
            >
              <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">About Macro</TooltipContent>
          </Tooltip>
        ) : (
          <ul className="m-0 flex list-none items-center justify-between gap-2 px-1.5 text-xs text-muted-foreground">
            <li>
              <a
                href="/"
                className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
              >
                About Macro
              </a>
            </li>
            <li>
              <a
                href="/privacy"
                className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
              >
                Privacy
              </a>
            </li>
            <li>
              <a
                href="/terms"
                className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
              >
                Terms
              </a>
            </li>
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Mobile sticky top bar and left-side navigation Sheet (`<= 860px`). */
export function MobileTopBar() {
  const { state, actions } = useShell();
  const navItems = useNavItems();

  const onNewTestClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    actions.navigateTo('/');
  };

  return (
    <header
      data-slot="shell-mobile-bar"
      className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5 min-[861px]:hidden print:hidden"
    >
      <a
        href="#/"
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-1 font-display text-[1.25rem] leading-none font-medium tracking-[-0.02em] text-foreground no-underline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring"
      >
        <BrandMark />
        <span>Macro</span>
      </a>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={actions.openQuickJump}
          aria-label="Open Quick Jump"
          className="border-bar bg-background"
        >
          <SearchIcon />
        </Button>

        <Sheet open={state.mobileOpen} onOpenChange={actions.setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label="Open navigation menu"
                aria-expanded={state.mobileOpen}
              />
            }
          >
            <MenuIcon data-icon="inline-start" />
            Menu
          </SheetTrigger>

          <SheetContent side="left" className="w-[min(86vw,320px)] gap-0 p-0">
            <SheetHeader className="border-b border-border px-4 py-3.5 text-left">
              <SheetTitle className="flex items-center gap-2.5 font-display text-[1.25rem] font-medium tracking-[-0.02em]">
                <BrandMark />
                <span>Macro</span>
              </SheetTitle>
              <SheetDescription className="sr-only">
                Workspace navigation, active target status, theme toggle, and account controls.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <Button
                render={<a href="#/" onClick={onNewTestClick} />}
                nativeButton={false}
                variant="default"
                className="w-full justify-start"
              >
                <PlusIcon data-icon="inline-start" />
                New test
              </Button>

              <nav aria-label="Mobile navigation">
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {navItems.map((item) => {
                    const active = isNavRouteActive(item.id, state.route);
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <a
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => actions.setMobileOpen(false)}
                          className={cn(
                            'flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[0.8125rem] font-medium no-underline transition-[background-color,color] duration-150 motion-reduce:transition-none focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring',
                            active
                              ? 'bg-secondary text-foreground'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                          )}
                        >
                          {active ? (
                            <span className="h-4 w-0.5 shrink-0 rounded-xs bg-accent-text" aria-hidden="true" />
                          ) : null}
                          <Icon className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <Separator />

              <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Active target</span>
                  <Badge variant={state.target.kind === 'verified' ? 'ok' : 'outline'}>
                    {state.target.badgeLabel}
                  </Badge>
                </div>
                <p className="truncate font-mono text-xs text-foreground">{state.target.host ?? 'Demo shop'}</p>
                {state.target.pendingHost !== null ? (
                  <a
                    href="#/verify-panel"
                    onClick={() => actions.setMobileOpen(false)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-warn underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                  >
                    <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>Finish verifying {state.target.pendingHost}</span>
                  </a>
                ) : null}
              </div>

              <div className="flex flex-col gap-2.5">
                {state.me !== null ? (
                  <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{state.identityLabel}</p>
                      {state.me.verifiedOrigin ? (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {state.me.verifiedOrigin.host}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        render={<a href="#/account" onClick={() => actions.setMobileOpen(false)} />}
                        nativeButton={false}
                        variant="outline"
                        size="sm"
                        className="flex-1 border-bar"
                      >
                        <UserIcon data-icon="inline-start" />
                        Account
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={state.signingOut}
                        onClick={() => void actions.signOut()}
                      >
                        <LogOutIcon data-icon="inline-start" />
                        {state.signingOut ? 'Signing out…' : 'Sign out'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    render={<a href="#/sign-in" onClick={() => actions.setMobileOpen(false)} />}
                    nativeButton={false}
                    variant="outline"
                    className="w-full justify-start border-bar bg-background"
                  >
                    <UserIcon data-icon="inline-start" />
                    Sign in
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  onClick={actions.toggleTheme}
                  aria-pressed={state.theme === 'dark'}
                  className="w-full justify-between border-bar bg-background"
                >
                  <span className="inline-flex items-center gap-2">
                    {state.theme === 'dark' ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
                    <span>Theme</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {state.theme === 'dark' ? 'Dark' : 'Light'}
                  </span>
                </Button>
              </div>
            </div>

            <SheetFooter className="border-t border-border px-4 py-3">
              <ul className="m-0 flex list-none items-center justify-between gap-3 p-0 text-xs text-muted-foreground">
                <li>
                  <a
                    href="/"
                    className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                  >
                    About Macro
                  </a>
                </li>
                <li>
                  <a
                    href="/privacy"
                    className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                  >
                    Privacy
                  </a>
                </li>
                <li>
                  <a
                    href="/terms"
                    className="rounded-sm py-1 text-muted-foreground no-underline hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                  >
                    Terms
                  </a>
                </li>
              </ul>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
