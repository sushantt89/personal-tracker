import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api/client';
import type { AlertInbox } from '../api/types';

/** In-app notifications with read state. Refreshed every minute and whenever the app comes back into view. */
export function useAlerts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => get<AlertInbox>('/alerts'), refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 20_000 });
  const act = async (action: 'read' | 'unread' | 'dismiss', body: { keys?: string[]; all?: boolean }) => {
    // Update the list straight away, then confirm with the server
    qc.setQueryData<AlertInbox>(['alerts'], (old) => {
      if (!old) return old;
      const hit = (k: string) => body.all || body.keys?.includes(k);
      const items = action === 'dismiss' ? old.items.filter((a) => !hit(a.key)) : old.items.map((a) => (hit(a.key) ? { ...a, read: action === 'read' } : a));
      return { items, unread: items.filter((a) => !a.read).length };
    });
    try { qc.setQueryData(['alerts'], await post<AlertInbox>(`/alerts/${action}`, body)); } catch { qc.invalidateQueries({ queryKey: ['alerts'] }); }
  };
  return { ...q, items: q.data?.items ?? [], unread: q.data?.unread ?? 0, act };
}
