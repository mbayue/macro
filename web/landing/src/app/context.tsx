import { createContext, useContext } from 'react';
import type { ConfigResponse, MeResponse } from '../../../../src/api-types.ts';

export interface AppContextValue {
  config: ConfigResponse;
  /** Current session identity, or null when signed out / unavailable. */
  me: MeResponse | null;
  /** Reload `/api/me`. */
  refreshMe: () => Promise<void>;
  /** Go to a hash route such as `/run/abc`. Re-renders when the hash is already that route. */
  navigate: (path: string) => void;
  /** Say something through the polite live region (re-read even when repeated). */
  announce: (message: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside <AppContext>');
  return ctx;
}
