import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Stack, Typography, IconButton, Button, Card, Checkbox, Chip, Grid, alpha, useTheme, Link, Alert } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import DirectionsIcon from '@mui/icons-material/Directions';
import RepeatIcon from '@mui/icons-material/Repeat';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import { get, patch, post, del } from '../api/client';
import type { CalendarEvent, Task, Job, TravelDay } from '../api/types';
import { PageHeader, SectionCard, LoadingBlock, StatusChip, useConfirm } from '../components/common';
import { EntityFormDialog } from '../components/EntityForm';
import { taskFields, taskDefaults, jobFields, withFormattedAddress } from '../utils/forms';
import { addDays, fmtDay, fmtTime, money, localToday, directionsUrl, fmtDate } from '../utils/format';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import { useThemeMode } from '../theme/ThemeModeProvider';

const START_HOUR = 6, END_HOUR = 22, HOUR_PX = 56;
const toMin = (t?: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0);
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function MyDay() {
  const theme = useTheme();
  const { chart } = useThemeMode();
  const nav = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? localToday();
  const setDate = (d: string) => setParams(d === localToday() ? {} : { date: d });
  const [editingTask, setEditingTask] = useState<{ id?: string; initial: Record<string, unknown> } | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const day = useQuery({ queryKey: ['calendar', date, date], queryFn: () => get<{ items: CalendarEvent[] }>('/calendar', { from: date, to: date }) });
  const week = useQuery({ queryKey: ['calendar', addDays(date, 1), addDays(date, 7)], queryFn: () => get<{ items: CalendarEvent[] }>('/calendar', { from: addDays(date, 1), to: addDays(date, 7) }) });
  const travel = useQuery({ queryKey: ['travel', 'day', date], queryFn: () => get<{ enabled: boolean; provider: string; day: TravelDay | null }>('/travel/day', { date }) });
  const events = day.data?.items ?? [];
  const timed = events.filter((e) => e.startTime);
  const untimed = events.filter((e) => !e.startTime);
  const jobs = events.filter((e) => e.type === 'job' && e.status !== 'cancelled');
  const color: Record<string, string> = { job: chart[0], task: chart[2], bill: chart[1], invoice: chart[6] };

  // Simple overlap layout: assign columns to overlapping events
  const layout = useMemo(() => {
    const sorted = [...timed].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    const cols: number[] = [];
    return sorted.map((e) => {
      const s = toMin(e.startTime), en = e.endTime ? (toMin(e.endTime) < s ? 24 * 60 : Math.max(toMin(e.endTime), s + 30)) : s + 60; // a finish time before the start runs past midnight
      let col = cols.findIndex((end) => end <= s);
      if (col === -1) { col = cols.length; cols.push(en); } else cols[col] = en;
      return { e, s, en, col };
    }).map((x, _, arr) => ({ ...x, cols: Math.max(1, ...arr.filter((y) => y.s < x.en && y.en > x.s).map((y) => y.col + 1)) }));
  }, [timed]);

  const reschedule = async (ev: CalendarEvent, hour: number) => {
    const dur = ev.endTime ? toMin(ev.endTime) - toMin(ev.startTime) : 60;
    const start = hour * 60;
    const body = { startTime: fromMin(start), ...(ev.endTime ? { endTime: fromMin(Math.min(start + dur, 23 * 60 + 59)) } : {}) };
    try {
      await patch(`/${ev.type === 'job' ? 'jobs' : 'tasks'}/${ev.refId}`, body);
      invalidate();
      toast(`Moved to ${fmtTime(body.startTime)}`);
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const toggleDone = async (ev: CalendarEvent) => {
    const done = ev.status === 'completed';
    if (ev.type === 'task') await patch(`/tasks/${ev.refId}/occurrence`, { date: ev.date, status: done ? 'not_started' : 'completed' });
    else if (ev.type === 'job') await patch(`/jobs/${ev.refId}`, { status: done ? 'scheduled' : 'completed' });
    invalidate();
  };

  const open = async (ev: CalendarEvent) => {
    if (ev.type === 'task') { const t = await get<Task>(`/tasks/${ev.refId}`); setEditingTask({ id: t.id, initial: { ...t, recurrence: t.recurrence ?? { frequency: 'none' } } }); }
    else if (ev.type === 'job') setEditingJob(await get<Job>(`/jobs/${ev.refId}`));
    else if (ev.type === 'bill') nav('/bills');
    else nav(`/invoices/${ev.refId}`);
  };

  const EventChip = ({ ev, compact }: { ev: CalendarEvent; compact?: boolean }) => (
    <Stack direction="row" spacing={0.5} alignItems="flex-start" sx={{ height: '100%', overflow: 'hidden' }}>
      {(ev.type === 'task' || ev.type === 'job') && (
        <Checkbox size="small" checked={ev.status === 'completed'} onClick={(e) => e.stopPropagation()} onChange={() => toggleDone(ev)} sx={{ p: 0.25 }} slotProps={{ input: { 'aria-label': `Mark ${ev.title} done` } }} />
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ textDecoration: ev.status === 'completed' ? 'line-through' : undefined }}>
          {ev.title}{ev.amount ? ` · ${money(ev.amount)}` : ''}
        </Typography>
        {!compact && <Typography variant="caption" color="text.secondary" noWrap component="div">{ev.startTime ? `${fmtTime(ev.startTime)}${ev.endTime ? '–' + fmtTime(ev.endTime) : ''}` : ev.type}{ev.location ? ` · ${ev.location}` : ''}</Typography>}
      </Box>
      {ev.recurring && <RepeatIcon sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }} />}
    </Stack>
  );

  return (
    <Box>
      <PageHeader
        title="My Day"
        subtitle={date === localToday() ? `Today · ${fmtDay(date)}` : fmtDay(date)}
        actions={<>
          <Stack direction="row" alignItems="center">
            <IconButton aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeftIcon /></IconButton>
            <Button onClick={() => setDate(localToday())} disabled={date === localToday()}>Today</Button>
            <IconButton aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><ChevronRightIcon /></IconButton>
            <input type="date" aria-label="Pick a date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ marginLeft: 8, padding: 6, borderRadius: 8, border: `1px solid ${theme.palette.divider}`, background: 'transparent', color: theme.palette.text.primary, font: 'inherit' }} />
          </Stack>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditingTask({ initial: taskDefaults(date) })}>Add task</Button>
        </>}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card>
            {day.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock rows={6} /></Box> : (
              <Box sx={{ position: 'relative', height: (END_HOUR - START_HOUR + 1) * HOUR_PX, ml: 7, mr: 1, my: 1 }}>
                {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i).map((h) => (
                  <Box key={h}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = alpha(theme.palette.primary.main, 0.08); }}
                    onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
                    onDrop={(e) => { e.currentTarget.style.background = ''; const id = e.dataTransfer.getData('text/plain'); const ev = events.find((x) => x.id === id); if (ev) reschedule(ev, h); }}
                    onDoubleClick={() => setEditingTask({ initial: { ...taskDefaults(date), startTime: fromMin(h * 60), endTime: fromMin(h * 60 + 60) } })}
                    sx={{ position: 'absolute', left: 0, right: 0, top: (h - START_HOUR) * HOUR_PX, height: HOUR_PX, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', left: -52, top: -9, width: 46, textAlign: 'right' }}>{fmtTime(fromMin(h * 60)).replace(':00', '')}</Typography>
                  </Box>
                ))}
                {date === localToday() && (() => { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes(); return m >= START_HOUR * 60 && m <= END_HOUR * 60 + 59 ? <Box sx={{ position: 'absolute', left: -6, right: 0, top: ((m - START_HOUR * 60) / 60) * HOUR_PX, height: 2, bgcolor: 'error.main', zIndex: 3, '&::before': { content: '""', position: 'absolute', left: 0, top: -4, width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' } }} /> : null; })()}
                {layout.map(({ e, s, en, col, cols }) => {
                  const top = Math.max(0, ((s - START_HOUR * 60) / 60) * HOUR_PX);
                  const height = Math.max(28, ((en - s) / 60) * HOUR_PX - 3);
                  const draggable = e.type === 'task' || e.type === 'job';
                  return (
                    <Box key={e.id} draggable={draggable} onDragStart={(d) => d.dataTransfer.setData('text/plain', e.id)} onClick={() => open(e)}
                      sx={{ position: 'absolute', top, height, left: `calc(${(col / cols) * 100}% + 4px)`, width: `calc(${100 / cols}% - 8px)`, zIndex: 2, cursor: 'pointer',
                        bgcolor: alpha(color[e.type], theme.palette.mode === 'dark' ? 0.22 : 0.12), borderLeft: 3, borderColor: color[e.type], borderRadius: 1.5, px: 1, py: 0.5, overflow: 'hidden',
                        opacity: e.status === 'cancelled' ? 0.5 : 1, '&:hover': { bgcolor: alpha(color[e.type], 0.28) } }}>
                      <Stack direction="row" sx={{ height: '100%' }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}><EventChip ev={e} compact={height < 44} /></Box>
                        {draggable && <DragIndicatorIcon sx={{ fontSize: 16, color: 'text.disabled', cursor: 'grab' }} />}
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Card>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{window.matchMedia('(pointer: coarse)').matches ? 'Tap a task or job to open it and change its time. Use “Add task” for a new one.' : 'Drag a task or job to another hour to reschedule. Double-click an empty hour to add a task.'}</Typography>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2}>
            <SectionCard title="Anytime today" subtitle="Tasks without a time, bills and invoices due">
              {!untimed.length ? <Typography variant="body2" color="text.secondary">Nothing else today.</Typography> : (
                <Stack spacing={1}>
                  {untimed.map((e) => (
                    <Box key={e.id} onClick={() => open(e)} sx={{ cursor: 'pointer', borderLeft: 3, borderColor: color[e.type], pl: 1, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                      <Stack direction="row" alignItems="center" spacing={1}><Box sx={{ flex: 1, minWidth: 0 }}><EventChip ev={e} /></Box>{e.type !== 'task' && <StatusChip status={e.status} />}</Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </SectionCard>
            {jobs.length > 0 && (
              <SectionCard title="Work today" subtitle={`${jobs.length} job(s) · ${money(jobs.reduce((a, j) => a + (j.amount ?? 0), 0))}`}
                action={jobs.filter((j) => j.location).length > 1 ? <Button size="small" startIcon={<DirectionsIcon />} href={directionsUrl(jobs.filter((j) => j.location).map((j) => j.location!)) ?? '#'} target="_blank">Route</Button> : undefined}>
                <Stack spacing={0.5}>
                  {(() => {
                    const legTo = new Map((travel.data?.day?.legs ?? []).filter((l) => l.toJobId).map((l) => [l.toJobId!, l]));
                    const startsHome = travel.data?.day?.stops[0]?.kind === 'home';
                    const homeLeg = travel.data?.day?.legs.find((l, i, arr) => i === arr.length - 1 && !l.toJobId);
                    const Leg = ({ km, minutes }: { km: number; minutes: number }) => (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: '72px', color: 'text.secondary' }}>
                        <DirectionsCarOutlinedIcon sx={{ fontSize: 15 }} />
                        <Typography variant="caption">{km.toFixed(1)} km · {minutes} min</Typography>
                      </Stack>
                    );
                    return (
                      <>
                        {startsHome && <Typography variant="caption" color="text.secondary" sx={{ pl: '72px' }}>Start: Home</Typography>}
                        {jobs.map((j) => {
                          const leg = legTo.get(j.refId);
                          return (
                            <Box key={j.id}>
                              {leg && leg.km > 0 && <Leg km={leg.km} minutes={leg.minutes} />}
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                                <Typography variant="body2" sx={{ width: 64, color: 'text.secondary' }}>{fmtTime(j.startTime)}</Typography>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2" fontWeight={500} noWrap>{j.title}</Typography>
                                  {j.location && <Link variant="caption" href={directionsUrl([j.location])} target="_blank" rel="noreferrer" color="text.secondary" underline="hover" noWrap component="a" sx={{ display: 'block' }}>{j.location}</Link>}
                                </Box>
                                <Typography variant="body2" fontWeight={600}>{money(j.amount)}</Typography>
                              </Stack>
                            </Box>
                          );
                        })}
                        {homeLeg && <><Leg km={homeLeg.km} minutes={homeLeg.minutes} /><Typography variant="caption" color="text.secondary" sx={{ pl: '72px' }}>Back home</Typography></>}
                      </>
                    );
                  })()}
                </Stack>
                {travel.data?.enabled ? (
                  travel.data.day ? (
                    <Box sx={{ mt: 1.5 }}>
                      {travel.data.day.error && <Alert severity="warning" sx={{ mb: 1 }}>{travel.data.day.error}</Alert>}
                      {travel.data.day.missing.map((m) => <Alert key={m.jobId} severity="info" sx={{ mb: 1 }}>{m.label}: {m.reason.toLowerCase()}{m.address ? ` (${m.address})` : ''}. Edit the job's address to include it.</Alert>)}
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" icon={<DirectionsCarOutlinedIcon />} label={`${travel.data.day.totalKm.toFixed(1)} km · ${Math.floor(travel.data.day.totalMinutes / 60) ? `${Math.floor(travel.data.day.totalMinutes / 60)} h ` : ''}${travel.data.day.totalMinutes % 60} min driving`} />
                        <Chip size="small" variant="outlined" label={`Fuel ≈ ${money(travel.data.day.fuel.cost)}`} />
                        <Chip size="small" variant="outlined" color="success" label={`After fuel ${money(jobs.reduce((a, j) => a + (j.amount ?? 0), 0) - travel.data.day.fuel.cost)}`} />
                        {travel.data.day.totalKm > 0 && <Chip size="small" variant="outlined" label={`${money(jobs.reduce((a, j) => a + (j.amount ?? 0), 0) / travel.data.day.totalKm)} per km`} />}
                        <Button size="small" onClick={async () => { try { await post('/travel/day/recalculate', { date }); travel.refetch(); } catch (e) { toast((e as Error).message, 'error'); } }}>Recalculate</Button>
                      </Stack>
                    </Box>
                  ) : travel.isFetching ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Working out today's route…</Typography> : null
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Turn on <Link component={RouterLink} to="/settings?tab=travel">Distance & travel</Link> to see km, drive time and fuel cost between jobs.</Typography>
                )}
              </SectionCard>
            )}
            <SectionCard title="Upcoming week" subtitle="Next 7 days">
              {week.isLoading ? <LoadingBlock rows={3} /> : (
                <Stack spacing={1.25}>
                  {Array.from({ length: 7 }, (_, i) => addDays(date, i + 1)).map((d) => {
                    const evs = (week.data?.items ?? []).filter((e) => e.date === d && e.status !== 'cancelled');
                    const income = evs.filter((e) => e.type === 'job').reduce((a, e) => a + (e.amount ?? 0), 0);
                    const billsAmt = evs.filter((e) => e.type === 'bill' && e.status !== 'paid').reduce((a, e) => a + (e.amount ?? 0), 0);
                    return (
                      <Box key={d} onClick={() => setDate(d)} sx={{ cursor: 'pointer', '&:hover .day': { color: 'primary.main' } }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                          <Typography className="day" variant="body2" fontWeight={600}>{fmtDate(d, 'ddd D MMM')}</Typography>
                          <Stack direction="row" spacing={0.5}>
                            {income > 0 && <Chip size="small" label={`+${money(income, { cents: false })}`} color="success" variant="outlined" />}
                            {billsAmt > 0 && <Chip size="small" label={`−${money(billsAmt, { cents: false })}`} color="warning" variant="outlined" />}
                          </Stack>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          {evs.length ? evs.map((e) => `${e.startTime ? fmtTime(e.startTime) + ' ' : ''}${e.title}`).join(' · ') : 'Free'}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>

      <EntityFormDialog open={!!editingTask} title={editingTask?.id ? 'Edit task' : 'Add task'} fields={taskFields} initial={editingTask?.initial ?? {}} onClose={() => setEditingTask(null)}
        onSubmit={async (v) => { if (editingTask?.id) await patch(`/tasks/${editingTask.id}`, v); else await post('/tasks', v); invalidate(); toast('Task saved'); }}
        extra={editingTask?.id ? <Button color="error" sx={{ mt: 2 }} onClick={async () => { const id = editingTask.id!; if (await confirm({ title: 'Delete this task?', message: 'Recurring tasks are deleted for all dates.', confirmText: 'Delete', danger: true })) { await del(`/tasks/${id}`); setEditingTask(null); invalidate(); toast('Task deleted'); } }}>Delete task</Button> : undefined} />
      <EntityFormDialog open={!!editingJob} title="Edit job" fields={jobFields} initial={editingJob ? { ...editingJob, address: editingJob.address ?? {} } : {}} onClose={() => setEditingJob(null)}
        onSubmit={async (v) => { await patch(`/jobs/${editingJob!.id}`, withFormattedAddress(v)); invalidate(); toast('Job saved'); }} />
    </Box>
  );
}
