import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { makeJobDerive } from '../utils/forms';
import { get } from '../api/client';
import type { Category, IncomeSource, Client, Settings, List, Integrations } from '../api/types';

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => get<List<Category>>('/categories'), select: (d) => d.items, staleTime: 60_000 });
export const useIncomeSources = () => useQuery({ queryKey: ['income-sources'], queryFn: () => get<List<IncomeSource>>('/income-sources'), select: (d) => d.items, staleTime: 60_000 });
export const useClients = () => useQuery({ queryKey: ['clients'], queryFn: () => get<List<Client>>('/clients'), select: (d) => d.items, staleTime: 30_000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), staleTime: 60_000 });

/** Rate and pay auto-fill for the job form (see makeJobDerive). */
export function useJobDerive() {
  const clients = useClients().data, sources = useIncomeSources().data;
  return useMemo(() => makeJobDerive(clients ?? [], sources ?? []), [clients, sources]);
}

export function useLookupMaps() {
  const cats = useCategories().data ?? [];
  const srcs = useIncomeSources().data ?? [];
  return {
    categories: cats,
    sources: srcs,
    catById: new Map(cats.map((c) => [c.id, c])),
    srcById: new Map(srcs.map((s) => [s.id, s])),
  };
}
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => get<Integrations>('/integrations'), staleTime: 30_000 });
