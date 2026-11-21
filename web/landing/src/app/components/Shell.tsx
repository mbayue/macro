/**
 * Composable workspace shell: skip link, collapsible desktop rail (mobile top bar + Sheet under 860px),
 * sticky top context bar, main content region, Ctrl/Cmd+K Quick Jump, and polite live region.
 */
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Route } from '../router.ts';
import { QuickJump } from './shell/QuickJump.tsx';
import { DesktopRail, MobileTopBar } from './shell/Rail.tsx';
import { ShellProvider, useShell } from './shell/ShellContext.tsx';
import { TopContextBar } from './shell/TopContextBar.tsx';

function ShellLayout({
  live,
  mainRef,
  children,
}: {
  live: string;
  mainRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { state } = useShell();
  const me = state.me;

  return (
    <div
      data-slot="app-shell"
      className="grid min-h-screen grid-cols-1 [--rail:240px] data-[rail-collapsed=true]:[--rail:64px] min-[861px]:grid-cols-[var(--rail)_minmax(0,1fr)] print:block"
      data-rail-collapsed={state.railCollapsed ? 'true' : 'false'}
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2.5 focus:text-[0.8125rem] focus:font-medium focus:text-primary-foreground focus:no-underline print:hidden"
        href="#main"
        onClick={(e) => {
          // A bare "#main" would change the hash route.
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <DesktopRail />

      <div className="flex min-h-screen min-w-0 flex-col">
        <MobileTopBar />
        <TopContextBar />

        <main
          id="main"
          className="flex min-w-0 flex-1 flex-col px-4 pt-6 focus:outline-none min-[861px]:px-10 min-[861px]:pt-8 print:px-0 print:pt-0"
          ref={mainRef}
          tabIndex={-1}
        >
          {children}
          <footer
            data-slot="app-footer"
            className="mx-auto mt-auto w-full max-w-[1600px] pt-12 pb-5 text-xs text-muted-foreground print:hidden"
          >
            <p className="border-t border-border pt-3.5">
              {me?.verifiedOrigin
                ? `You can load-test ${typeof me.verifiedOrigin === 'string' ? me.verifiedOrigin : me.verifiedOrigin.host} (verified) or the public demo shop.`
                : 'Demo Target tests work signed out. Own-site tests need a signed-in account and a verified origin.'}
            </p>
          </footer>
        </main>
      </div>

      <QuickJump />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </div>
    </div>
  );
}

export function Shell({
  route,
  live,
  mainRef,
  children,
}: {
  route: Route;
  live: string;
  mainRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delay={200}>
      <ShellProvider route={route} mainRef={mainRef}>
        <ShellLayout live={live} mainRef={mainRef}>
          {children}
        </ShellLayout>
      </ShellProvider>
    </TooltipProvider>
  );
}
