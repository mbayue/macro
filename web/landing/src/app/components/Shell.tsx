/**
 * Composable workspace shell: skip link, collapsible desktop rail (mobile top bar + Sheet under 860px),
 * sticky top context bar, main content region, Ctrl/Cmd+K Quick Jump, and polite live region.
 */
import type { ReactNode } from 'react';
import { LogOutIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Route } from '../router.ts';
import { QuickJump } from './shell/QuickJump.tsx';
import { DesktopRail, MobileTopBar } from './shell/Rail.tsx';
import { ShellProvider, useShell } from './shell/ShellContext.tsx';
import { TopContextBar } from './shell/TopContextBar.tsx';
import { Busy } from './ui.tsx';

function SignOutDialog() {
  const { state, actions } = useShell();
  return (
    <Dialog open={state.signOutConfirmOpen} onOpenChange={(open) => !state.signingOut && actions.setSignOutConfirmOpen(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
          <DialogDescription>
            You will be signed out of{' '}
            <span className="font-medium text-foreground">{state.identityLabel ?? 'your account'}</span>. Your saved
            draft, verified domain, and private runs stay in your account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="secondary" disabled={state.signingOut} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={state.signingOut}
            onClick={() => void actions.confirmSignOut()}
          >
            {state.signingOut ? (
              <Busy>Signing out…</Busy>
            ) : (
              <>
                <LogOutIcon data-icon="inline-start" />
                Sign out
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      className="grid min-h-dvh grid-cols-1 min-[861px]:grid-cols-[240px_minmax(0,1fr)] min-[861px]:data-[rail-collapsed=true]:grid-cols-[64px_minmax(0,1fr)] min-[861px]:transition-[grid-template-columns] min-[861px]:duration-150 motion-reduce:transition-none print:block"
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

      <div className="flex min-h-dvh min-w-0 flex-col">
        <MobileTopBar />
        <TopContextBar />

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="atmo-band print:hidden" aria-hidden="true">
            <img className="atmo-band-img atmo-band-light" src="/landing/img/dither/sanok-trucks.webp" width={1920} height={1280} alt="" />
            <img className="atmo-band-img atmo-band-dark" src="/landing/img/dither/dark-horizon.webp" width={1920} height={1280} alt="" />
            <div className="atmo-band-scrim" />
          </div>

          <main
            id="main"
            className="relative z-10 flex min-w-0 flex-1 flex-col px-4 pt-6 focus:outline-none min-[861px]:px-10 min-[861px]:pt-8 print:px-0 print:pt-0"
            ref={mainRef}
            tabIndex={-1}
          >
            {children}
            <footer
              data-slot="app-footer"
              className="mx-auto mt-auto w-full max-w-[1440px] pt-12 pb-5 text-xs text-muted-foreground print:hidden"
            >
              <p className="border-t border-border pt-3.5">
                {me?.verifiedOrigin
                  ? `You can load-test ${typeof me.verifiedOrigin === 'string' ? me.verifiedOrigin : me.verifiedOrigin.host} (verified) or the public demo shop.`
                  : 'Demo Target tests work signed out. Own-site tests need a signed-in account and a verified origin.'}
              </p>
            </footer>
          </main>
        </div>
      </div>

      <QuickJump />
      <SignOutDialog />

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
