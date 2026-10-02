import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertTitle, Button, IconButton, Snackbar, Stack } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useAlerts } from '../hooks/useAlerts';
import { useSettings } from '../hooks/useLookups';
import type { InboxAlert } from '../api/types';

interface Popup { id: number; title: string; message?: string; severity: InboxAlert['severity']; link: string; keys: string[] }
const SESSION_KEY = 'pt-alerts-greeted';

/** Pops up a small card inside the app when a new notification arrives, and keeps the app icon badge in step. */
export default function AlertPopups() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, unread, act } = useAlerts();
  const settings = useSettings();
  const enabled = settings.data ? settings.data.notifications?.inAppPopups !== false : false;
  const known = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Popup[]>([]);

  useEffect(() => {
    if (!data || !settings.data) return;
    const fresh = data.items.filter((a) => !a.read && !(known.current?.has(a.key) ?? false));
    const first = known.current === null;
    known.current = new Set([...(known.current ?? []), ...data.items.map((a) => a.key)]);
    if (!enabled || !fresh.length) return;
    if (first) {
      // Opening the app: one summary, once per browser session
      let greeted = false;
      try { greeted = sessionStorage.getItem(SESSION_KEY) === '1'; sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
      if (greeted) return;
    }
    const worst = fresh.some((a) => a.severity === 'error') ? 'error' : fresh.some((a) => a.severity === 'warning') ? 'warning' : 'info';
    const popup: Popup = fresh.length === 1
      ? { id: Date.now(), title: fresh[0].title, message: fresh[0].message, severity: fresh[0].severity, link: fresh[0].link ?? '/notifications', keys: [fresh[0].key] }
      : { id: Date.now(), title: `${fresh.length} new notifications`, message: fresh.slice(0, 3).map((a) => a.title).join(' · '), severity: worst, link: '/notifications', keys: [] };
    setQueue((q) => [...q.slice(-2), popup]);
  }, [data, enabled, settings.data]);

  // Number on the installed app's icon (where the device supports it)
  useEffect(() => {
    const n = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!data) return;
    (unread ? n.setAppBadge?.(unread) : n.clearAppBadge?.())?.catch(() => undefined);
  }, [unread, data]);

  // A phone notification just arrived while the app is open: refresh the bell
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'pt-push') qc.invalidateQueries({ queryKey: ['alerts'] }); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [qc]);

  // Opening the notifications page makes any pop-up redundant
  const { pathname } = useLocation();
  useEffect(() => { if (pathname === '/notifications') setQueue([]); }, [pathname]);

  const current = queue[0];
  const next = () => setQueue((q) => q.slice(1));
  return (
    <Snackbar key={current?.id} open={!!current} autoHideDuration={7000} onClose={(_, reason) => { if (reason !== 'clickaway') next(); }}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }} sx={{ zIndex: (t) => t.zIndex.appBar + 1, top: { xs: 'calc(68px + env(safe-area-inset-top))', sm: 76 } }}>
      <Alert severity={current?.severity ?? 'info'} variant="outlined" role="status"
        sx={{ bgcolor: 'background.paper', boxShadow: 6, width: '100%', maxWidth: 420, alignItems: 'flex-start' }}
        action={<Stack direction="row" alignItems="center">
          <Button size="small" color="inherit" onClick={() => { if (current?.keys.length) act('read', { keys: current.keys }); next(); if (current) nav(current.link); }}>View</Button>
          <IconButton size="small" color="inherit" aria-label="Close" onClick={next}><CloseIcon fontSize="small" /></IconButton>
        </Stack>}>
        <AlertTitle sx={{ mb: current?.message ? 0.25 : 0 }}>{current?.title}</AlertTitle>
        {current?.message}
      </Alert>
    </Snackbar>
  );
}
