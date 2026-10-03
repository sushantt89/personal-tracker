import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Box, Card, Stack, IconButton, Button, Typography, Chip, alpha, useTheme, useMediaQuery } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import { get, post } from '../api/client';
import { EntityFormDialog } from '../components/EntityForm';
import { taskFields, taskDefaults, addToGoogleField } from '../utils/forms';
import { useIntegrations } from '../hooks/useLookups';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import type { CalendarEvent } from '../api/types';
import { PageHeader, LoadingBlock } from '../components/common';
import { money, fmtTime, localToday } from '../utils/format';
import { useThemeMode } from '../theme/ThemeModeProvider';

const TYPES = [
  { key: 'job', label: 'Jobs', slot: 0 },
  { key: 'task', label: 'Tasks & appointments', slot: 2 },
  { key: 'bill', label: 'Bills', slot: 1 },
  { key: 'invoice', label: 'Invoice due dates', slot: 6 },
  { key: 'google', label: 'Google Calendar', slot: 4 },
] as const;

export default function CalendarPage() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { chart } = useThemeMode();
  const nav = useNavigate();
  const [month, setMonth] = useState(dayjs(localToday()).startOf('month'));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const gridStart = month.subtract((month.day() + 6) % 7, 'day');
  const gridEnd = gridStart.add(41, 'day');
  const q = useQuery({ queryKey: ['calendar', gridStart.format('YYYY-MM-DD'), gridEnd.format('YYYY-MM-DD')], queryFn: () => get<{ items: CalendarEvent[]; google?: { shown: number; error: string | null } | null }>('/calendar', { from: gridStart.format('YYYY-MM-DD'), to: gridEnd.format('YYYY-MM-DD') }) });
  const integrations = useIntegrations();
  const googleConnected = !!integrations.data?.googleCalendar.connected;
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const [adding, setAdding] = useState<Record<string, unknown> | null>(null);
  const types = TYPES.filter((t) => t.key !== 'google' || !!q.data?.google);
  const events = (q.data?.items ?? []).filter((e) => !hidden.has(e.type));
  const color = Object.fromEntries(TYPES.map((t) => [t.key, chart[t.slot]]));
  const today = localToday();
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const monthEvents = events.filter((e) => e.date.startsWith(month.format('YYYY-MM')));

  return (
    <Box>
      <PageHeader title="Calendar" subtitle={`${monthEvents.filter((e) => e.type === 'job').length} jobs · ${money(monthEvents.filter((e) => e.type === 'bill').reduce((a, e) => a + (e.amount ?? 0), 0))} in bills this month`}
        actions={<Stack direction="row" alignItems="center">
          <IconButton aria-label="Previous month" onClick={() => setMonth(month.subtract(1, 'month'))}><ChevronLeftIcon /></IconButton>
          <Typography variant="subtitle1" sx={{ minWidth: 150, textAlign: 'center' }}>{month.format('MMMM YYYY')}</Typography>
          <IconButton aria-label="Next month" onClick={() => setMonth(month.add(1, 'month'))}><ChevronRightIcon /></IconButton>
          <Button onClick={() => setMonth(dayjs(today).startOf('month'))}>Today</Button>
          <Button variant="contained" startIcon={<AddIcon />} sx={{ ml: 1 }} onClick={() => setAdding({ ...taskDefaults(month.isSame(dayjs(today), 'month') ? today : month.format('YYYY-MM-DD')), category: 'event', addToGoogle: googleConnected })}>Add event</Button>
        </Stack>} />
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {types.map((t) => (
          <Chip key={t.key} label={t.label} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}
            variant={hidden.has(t.key) ? 'outlined' : 'filled'} icon={<Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: color[t.key], ml: '8px !important' }} />} />
        ))}
      </Stack>
      <Card>
        {q.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock rows={6} height={70} /></Box> : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <Typography key={d} variant="caption" color="text.secondary" fontWeight={600} sx={{ p: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'center' }}>{mobile ? d[0] : d}</Typography>
            ))}
            {days.map((d) => {
              const ds = d.format('YYYY-MM-DD');
              const evs = events.filter((e) => e.date === ds);
              const inMonth = d.month() === month.month();
              return (
                <Box key={ds} onClick={() => nav(`/my-day?date=${ds}`)}
                  sx={{ minHeight: { xs: 64, md: 112 }, p: 0.75, borderRight: 1, borderBottom: 1, borderColor: 'divider', cursor: 'pointer', bgcolor: inMonth ? undefined : 'action.hover', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) }, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: ds === today ? 700 : 500, color: ds === today ? 'primary.contrastText' : inMonth ? 'text.primary' : 'text.disabled', bgcolor: ds === today ? 'primary.main' : undefined, borderRadius: 10, px: 0.75, py: 0.1 }}>{d.date()}</Typography>
                  {mobile ? (
                    <Stack direction="row" spacing={0.4} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>{evs.slice(0, 6).map((e) => <Box key={e.id} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color[e.type] }} />)}</Stack>
                  ) : (
                    <Stack spacing={0.4} sx={{ mt: 0.5 }}>
                      {evs.slice(0, 4).map((e) => (
                        <Box key={e.id} title={`${e.title}${e.amount ? ' · ' + money(e.amount) : ''}`} sx={{ fontSize: 11.5, lineHeight: 1.35, px: 0.6, py: 0.15, borderRadius: 1, bgcolor: alpha(color[e.type], theme.palette.mode === 'dark' ? 0.25 : 0.14), borderLeft: 2, borderColor: color[e.type], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: e.status === 'completed' || e.status === 'paid' ? 'line-through' : undefined, opacity: e.status === 'cancelled' ? 0.5 : 1 }}>
                          {e.startTime ? fmtTime(e.startTime).replace(':00', '') + ' ' : ''}{e.title}
                        </Box>
                      ))}
                      {evs.length > 4 && <Typography variant="caption" color="text.secondary">+{evs.length - 4} more</Typography>}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Card>
      {q.data?.google?.error && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>Your Google Calendar events couldn’t be loaded just now. Check the connection under Settings → Integrations.</Typography>}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Tap a day to open it in My Day. {q.data?.google ? 'Events from your Google Calendar are shown here too; tap one in My Day to open it in Google.' : 'Connect Google under Settings → Integrations to see your Google Calendar events here and add new ones to it.'}
      </Typography>
      <EntityFormDialog open={!!adding} title="Add event" fields={googleConnected ? [...taskFields, addToGoogleField] : taskFields} initial={adding ?? {}} onClose={() => setAdding(null)}
        onSubmit={async (v) => { await post('/tasks', googleConnected ? v : { ...v, addToGoogle: undefined }); await invalidate(); toast(googleConnected && v.addToGoogle ? 'Event added — it will appear in Google Calendar shortly' : 'Event added'); }} />
    </Box>
  );
}
