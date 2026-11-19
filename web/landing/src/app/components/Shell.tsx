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
    <div className="shell" data-rail-collapsed={state.railCollapsed ? 'true' : 'false'}>
      <a
        className="skip-link"
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

        <main id="main" className="main" ref={mainRef} tabIndex={-1}>
          {children}
          <footer className="app-foot">
            <p>
              {me?.verifiedOrigin
                ? `You can load-test ${typeof me.verifiedOrigin === 'string' ? me.verifiedOrigin : me.verifiedOrigin.host} (verified) or the public demo shop.`
                : 'Demo shop tests work signed out. Own-site tests need a signed-in account and a verified origin.'}
            </p>
          </footer>
        </main>
      </div>

      <QuickJump />

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
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
