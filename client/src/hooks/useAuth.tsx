import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';
import { setCurrency } from '../utils/format';
import { useThemeMode } from '../theme/ThemeModeProvider';

interface AuthCtx { user: User | null; loading: boolean; /** The server could not be reached, so we don't know whether you are signed in */ unreachable: boolean; refresh: () => Promise<unknown>; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx>({ user: null, loading: true, unreachable: false, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setPref } = useThemeMode();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (e) {
        // Signed out is a normal answer; no answer at all (offline, server stopped) is not
        if (e instanceof ApiError && e.status < 500) return null;
        throw e;
      }
    },
    retry: false,
    networkMode: 'always',
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['me'], null));
  }, [qc]);
  useEffect(() => {
    if (q.data) {
      setCurrency(q.data.currency);
      if (q.data.theme) setPref(q.data.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.id, q.data?.currency, q.data?.theme]);
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      // Sign out on screen first (this is what sends you to the login page), then drop everything that was loaded for this account.
      // Clearing the whole cache in one go would leave the page holding on to the old signed-in user.
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
  };
  return <Ctx.Provider value={{ user: q.data ?? null, loading: q.isLoading, unreachable: q.isError && !q.data, refresh: q.refetch, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
