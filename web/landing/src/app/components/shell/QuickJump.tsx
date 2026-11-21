import { useEffect, useRef } from 'react';
import {
  ActivityIcon,
  AlertCircleIcon,
  GlobeIcon,
  LogInIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TablePropertiesIcon,
  UserIcon,
} from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { statusWords } from '../ui.tsx';
import { useShell } from './ShellContext.tsx';

/** Global Ctrl/Cmd+K Quick Jump dialog for routes, recent runs, and workspace actions. */
export function QuickJump() {
  const { state, actions, meta } = useShell();
  const navigatingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.quickJumpOpen) {
      navigatingRef.current = false;
    }
  }, [state.quickJumpOpen]);

  const selectRoute = (href: string) => {
    navigatingRef.current = true;
    actions.navigateTo(href);
  };

  const runLocalAction = (fn: () => void) => {
    navigatingRef.current = false;
    actions.setQuickJumpOpen(false);
    fn();
  };

  const resolveFinalFocus = () => {
    if (navigatingRef.current) return false;
    return meta.lastFocusBeforeQuickJumpRef.current ?? true;
  };

  return (
    <CommandDialog
      open={state.quickJumpOpen}
      onOpenChange={actions.setQuickJumpOpen}
      title="Quick Jump"
      description="Jump to an app route, recent run, or workspace action."
      initialFocus={inputRef}
      finalFocus={resolveFinalFocus}
    >
      <Command label="Quick Jump">
        <CommandInput ref={inputRef} autoFocus placeholder="Jump to a route, recent run, or action…" />
        <CommandList>
          <CommandEmpty>No matching routes, runs, or actions.</CommandEmpty>

          <CommandGroup heading="Routes">
            <CommandItem
              value="route:test-studio"
              keywords={['home', 'new', 'planner', 'studio']}
              onSelect={() => selectRoute('/')}
            >
              <SlidersHorizontalIcon />
              <span>Test Studio</span>
            </CommandItem>
            <CommandItem
              value="route:runs-table"
              keywords={['runs', 'history', 'recent', 'table']}
              onSelect={() => selectRoute('/runs')}
            >
              <TablePropertiesIcon />
              <span>Runs Table</span>
            </CommandItem>
            <CommandItem
              value="route:containment-probe"
              keywords={['probe', 'sandbox', 'security', 'containment']}
              onSelect={() => selectRoute('/probe')}
            >
              <ShieldCheckIcon />
              <span>Containment Probe</span>
            </CommandItem>
            <CommandItem
              value="route:domains"
              keywords={['domains', 'verify', 'dns', 'origin']}
              onSelect={() => selectRoute('/domains')}
            >
              <GlobeIcon />
              <span>Domains</span>
            </CommandItem>
            <CommandItem
              value="route:account"
              keywords={['account', 'profile', 'sign-in', 'auth']}
              onSelect={() => selectRoute(state.me !== null ? '/account' : '/sign-in')}
            >
              <UserIcon />
              <span>{state.me !== null ? 'Account' : 'Sign in'}</span>
            </CommandItem>
            {state.target.pendingHost !== null ? (
              <CommandItem
                value={`route:verify:${state.target.pendingHost}`}
                keywords={['verify', 'domain', 'origin', state.target.pendingHost]}
                onSelect={() => selectRoute('/domains')}
              >
                <AlertCircleIcon />
                <span className="truncate">Finish verifying {state.target.pendingHost}</span>
              </CommandItem>
            ) : null}
          </CommandGroup>

          {state.recentRuns.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup
                heading={state.recentRunsSource === 'account' ? 'Recent account runs' : 'Recent runs in this browser'}
              >
                {state.recentRuns.map((run) => (
                  <CommandItem
                    key={run.id}
                    value={`${run.title} ${run.id}`}
                    keywords={[run.id, run.shortId, run.kind, run.status ?? '']}
                    onSelect={() => selectRoute(run.href)}
                  >
                    {run.kind === 'probe' ? <ShieldCheckIcon /> : <ActivityIcon />}
                    <span className="truncate min-w-0">{run.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {run.status ? (
                        <span className="text-xs text-muted-foreground">{statusWords(run.status)}</span>
                      ) : null}
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{run.shortId}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem
              value="action:new-test"
              keywords={['new', 'create', 'plan', 'test']}
              onSelect={() => selectRoute('/')}
            >
              <PlusIcon />
              <span>New test</span>
            </CommandItem>
            <CommandItem
              value="action:toggle-theme"
              keywords={['theme', 'dark', 'light', 'appearance']}
              onSelect={() => runLocalAction(actions.toggleTheme)}
            >
              {state.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>Toggle theme</span>
              <CommandShortcut>{state.theme === 'dark' ? 'Dark' : 'Light'}</CommandShortcut>
            </CommandItem>
            {state.me !== null ? (
              <CommandItem
                value="action:sign-out"
                keywords={['logout', 'signout', 'account']}
                disabled={state.signingOut}
                onSelect={() => {
                  navigatingRef.current = true;
                  void actions.signOut();
                }}
              >
                <LogOutIcon />
                <span>{state.signingOut ? 'Signing out…' : 'Sign out'}</span>
              </CommandItem>
            ) : (
              <CommandItem
                value="action:sign-in"
                keywords={['login', 'signin', 'auth']}
                onSelect={() => selectRoute('/sign-in')}
              >
                <LogInIcon />
                <span>Sign in</span>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
