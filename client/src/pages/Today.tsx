import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Chip, Divider, Grid, IconButton, LinearProgress, Link, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import DirectionsIcon from '@mui/icons-material/Directions';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import dayjs from 'dayjs';
import { get, patch, post, del } from '../api/client';
import type { BillDue, Job, TravelDay } from '../api/types';
import { SectionCard, LoadingBlock, ErrorBlock, WeekChange } from '../components/common';
import SwipeAction from '../components/SwipeAction';
import { HoursBar, hrs, type WorkHoursData } from './WorkHours';
import { money, fmtDay, fmtShort, fmtTime, fmtDate, mapsUrl, routeGroups, localToday, addDays } from '../utils/format';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

/* eslint-disable @typescript-eslint/no-explicit-any */
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const jobHours = (j: Job) => {
  if (j.hoursWorked) return j.hoursWorked;
  if (!j.startTime || !j.endTime) return 0;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let d = m(j.endTime) - m(j.startTime); if (d <= 0) d += 1440;
  return d / 60;
};

/** The start screen: what today holds, where to drive, what is due, and how the week is going — on one page. */
export default function Today() {
  const nav = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const { user } = useAuth();
  const today = localToday();
  const tomorrow = addDays(today, 1);
  const dash = useQuery({ queryKey: ['dashboard', 'today-page', today], queryFn: () => get<any>('/dashboard', { from: today, to: today }) });
  const travel = useQuery({ queryKey: ['travel', 'day', today], queryFn: () => get<{ enabled: boolean; day: TravelDay | null }>('/travel/day', { date: today }) });
  const hours = useQuery({ queryKey: ['work-hours'], queryFn: () => get<WorkHoursData>('/work-hours') });
  const next = useQuery({ queryKey: ['jobs', 'tomorrow', tomorrow], queryFn: () => get<{ items: Job[] }>('/jobs', { from: tomorrow, to: tomorrow }) });
  const goals = useQuery({ queryKey: ['assistant', 'goals'], queryFn: () => get<{ goals: { id: string; name: string; status: string; thisWeek: { stillToPut: number } }[]; spare: { amount: number } }>('/assistant/goals') });
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<unknown> } | null>(null);

  if (dash.isLoading) return <LoadingBlock rows={6} height={72} />;
  if (dash.error || !dash.data) return <ErrorBlock error={dash.error} onRetry={dash.refetch} />;
  const d = dash.data;
  const jobs: Job[] = [...d.today.jobs].filter((j: Job) => j.status !== 'cancelled').sort((a: Job, b: Job) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
  const left = jobs.filter((j) => j.status !== 'completed');
  // The route covers the jobs still to do, so it never sends you back to one that is finished
  // Jobs more than an hour apart get their own route (a morning run and an evening job aren't one trip)
  const routes = routeGroups((left.length ? left : jobs).map((j) => ({ startTime: j.startTime, endTime: j.endTime, hours: j.hoursWorked, address: j.address?.formatted })));
  const tasks: any[] = d.today.tasks.filter((t: any) => t.status !== 'cancelled');
  const billsToday: BillDue[] = d.today.billsDue.filter((b: BillDue) => !b.paid);
  const billsSoon: BillDue[] = d.bills.upcoming.filter((b: BillDue) => b.dueDate > today && b.dueDate <= addDays(today, 7));
  const w = d.week;
  const toGo = Math.round((w.requiredIncome - w.incomeIncludingExpected) * 100) / 100;
  const tomorrowJobs = (next.data?.items ?? []).filter((j) => j.status !== 'cancelled').sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
  const h = hours.data;
  const activeGoals = (goals.data?.goals ?? []).filter((g) => g.status !== 'done' && g.status !== 'overdue');
  const toSave = activeGoals.reduce((a, g) => a + g.thisWeek.stillToPut, 0);
  const km = travel.data?.day?.totalKm ?? 0;

  const act = async (fn: () => Promise<unknown>, undoText?: string, undoFn?: () => Promise<unknown>) => {
    try { await fn(); await invalidate(); if (undoText && undoFn) setUndo({ text: undoText, run: undoFn }); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const complete = (j: Job) => act(() => patch(`/jobs/${j.id}`, { status: 'completed' }), `${j.clientName ?? 'Job'} marked completed`, () => patch(`/jobs/${j.id}`, { status: j.status }));
  const payBill = (b: BillDue) => act(async () => {
    const exp = await post<{ id: string }>(`/bills/${b.billId}/pay`, { occurrence: b.dueDate, date: today > b.dueDate ? b.dueDate : today });
    setUndo({ text: `${b.name} marked paid`, run: () => del(`/expenses/${exp.id}`) });
  });
  const doneTask = (t: any) => act(() => patch(`/tasks/${t.id}`, { status: 'completed' }), `“${t.title}” done`, () => patch(`/tasks/${t.id}`, { status: t.status }));

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 26, sm: 32 } }}>{greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Typography>
        <Typography color="text.secondary">{fmtDay(today)}</Typography>
      </Box>

      <Grid container spacing={2}>
        {/* Work today */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Stack spacing={2}>
          <Box><SectionCard
            title={jobs.length ? `Today’s work · ${jobs.length} job${jobs.length === 1 ? '' : 's'}` : 'Today’s work'}
            subtitle={jobs.length ? [`${hrs(jobs.reduce((a, j) => a + jobHours(j), 0))}`, jobs.some((j) => j.amount) ? money(jobs.reduce((a, j) => a + (j.amount ?? 0), 0)) : '', km > 0 ? `${Math.round(km * 10) / 10} km driving` : '', left.length ? `${left.length} to go` : 'all done'].filter(Boolean).join(' · ') : undefined}
            action={routes.length > 0 ? <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent="flex-end">{routes.map((r, i) => (
              <Button key={i} size="small" variant={i === 0 ? 'contained' : 'outlined'} startIcon={<DirectionsIcon />} href={r.url ?? '#'} target="_blank" rel="noreferrer">
                {routes.length > 1 ? `${r.startTime ? fmtTime(r.startTime) : `Route ${i + 1}`} · ${r.stops.length} stop${r.stops.length === 1 ? '' : 's'}` : r.stops.length > 1 ? 'Start route' : 'Directions'}
              </Button>))}</Stack> : undefined}
            noPad={jobs.length > 0}>
            {!jobs.length ? (
              <Box>
                <Typography variant="body1" sx={{ mb: 0.5 }}>No work scheduled today.</Typography>
                <Typography variant="body2" color="text.secondary">{d.work.upcoming?.[0] ? `Next: ${d.work.upcoming[0].clientName ?? 'a job'} on ${fmtDate(d.work.upcoming[0].date, 'dddd D MMM')}${d.work.upcoming[0].startTime ? ` at ${fmtTime(d.work.upcoming[0].startTime)}` : ''}.` : 'Nothing is booked yet.'}</Typography>
                <Button sx={{ mt: 1.5 }} onClick={() => nav('/import')}>Paste or upload a schedule</Button>
              </Box>
            ) : jobs.map((j, i) => {
              const done = j.status === 'completed';
              const row = (
                <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ px: 2, py: 1.5, opacity: done ? 0.6 : 1 }}>
                  <Box sx={{ width: 68, flexShrink: 0 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{j.startTime ? fmtTime(j.startTime) : 'Any time'}</Typography>
                    {j.endTime && <Typography variant="caption" color="text.secondary">to {fmtTime(j.endTime)}</Typography>}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body1" fontWeight={600} sx={{ textDecoration: done ? 'line-through' : undefined, cursor: 'pointer' }} onClick={() => nav(`/jobs?focus=${j.id}`)}>{j.clientName ?? j.title ?? 'Job'}</Typography>
                    {j.address?.formatted && <Link href={mapsUrl(j.address.formatted)} target="_blank" rel="noreferrer" variant="body2" color="text.secondary" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}><PlaceOutlinedIcon sx={{ fontSize: 15 }} />{j.address.formatted}</Link>}
                    {j.specialInstructions && <Typography variant="caption" color="text.secondary" component="div" sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}><KeyOutlinedIcon sx={{ fontSize: 14, mt: '2px', flexShrink: 0 }} />{j.specialInstructions}</Typography>}
                    {!!j.tasks?.length && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>{j.tasks.length} task{j.tasks.length === 1 ? '' : 's'}: {j.tasks.slice(0, 3).join(', ')}{j.tasks.length > 3 ? '…' : ''}</Typography>}
                    {!!j.distanceKm && <Typography variant="caption" color="text.secondary" component="div">{j.distanceKm.toFixed(1)} km · {j.travelMinutes ?? 0} min drive from the stop before</Typography>}
                  </Box>
                  <Stack alignItems="flex-end" spacing={0.25} sx={{ flexShrink: 0 }}>
                    {j.amount ? <Typography variant="body2" fontWeight={700}>{money(j.amount)}{j.amountEstimated ? ' est.' : ''}</Typography> : null}
                    <Tooltip title={done ? 'Completed' : 'Mark completed'}><span><IconButton aria-label={done ? 'Completed' : `Mark ${j.clientName ?? 'job'} completed`} disabled={done} onClick={() => complete(j)} color={done ? 'success' : 'default'}>{done ? <CheckCircleIcon /> : <CheckCircleOutlineIcon />}</IconButton></span></Tooltip>
                  </Stack>
                </Stack>
              );
              return <Box key={j.id}>{i > 0 && <Divider />}{done ? row : <SwipeAction label="Completed" onAction={() => complete(j)}>{row}</SwipeAction>}</Box>;
            })}
          </SectionCard></Box>

          {(tasks.length > 0 || billsToday.length > 0 || d.today.invoicesDue.length > 0) && (
            <Box>
              <SectionCard title="Also today">
                <Stack divider={<Divider flexItem />} spacing={1}>
                  {tasks.map((t) => (
                    <Stack key={t.id} direction="row" spacing={1} alignItems="center" sx={{ opacity: t.status === 'completed' ? 0.6 : 1 }}>
                      <Typography variant="body2" sx={{ width: 68, flexShrink: 0, color: 'text.secondary' }}>{t.startTime ? fmtTime(t.startTime) : 'All day'}</Typography>
                      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap sx={{ textDecoration: t.status === 'completed' ? 'line-through' : undefined }}>{t.title}</Typography>{t.location && <Typography variant="caption" color="text.secondary" noWrap component="div">{t.location}</Typography>}</Box>
                      {t.status !== 'completed' && <Button size="small" onClick={() => doneTask(t)}>Done</Button>}
                    </Stack>
                  ))}
                  {billsToday.map((b) => (
                    <Stack key={b.billId} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ width: 68, flexShrink: 0, color: 'warning.main', fontWeight: 600 }}>Bill due</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }} noWrap>{b.name} · {money(b.amount)}{b.autoPay ? ' · auto-pay' : ''}</Typography>
                      <Button size="small" onClick={() => payBill(b)}>Mark paid</Button>
                    </Stack>
                  ))}
                  {d.today.invoicesDue.map((inv: any) => (
                    <Stack key={inv.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => nav(`/invoices/${inv.id}`)}>
                      <Typography variant="body2" sx={{ width: 68, flexShrink: 0, color: 'text.secondary' }}>Invoice</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }} noWrap>{inv.number} due · {inv.clientName} · {money(inv.total)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </SectionCard>
            </Box>
          )}

          <Box>
            <SectionCard title="Tomorrow" subtitle={fmtDay(tomorrow)} action={<Button size="small" onClick={() => nav(`/my-day?date=${tomorrow}`)}>Open</Button>}>
              {next.isLoading ? <LoadingBlock rows={1} /> : !tomorrowJobs.length ? <Typography variant="body2" color="text.secondary">No work scheduled.</Typography> : (
                <Typography variant="body2">
                  <b>{tomorrowJobs.length} job{tomorrowJobs.length === 1 ? '' : 's'}</b>{tomorrowJobs[0].startTime ? <>, first at <b>{fmtTime(tomorrowJobs[0].startTime)}</b></> : null} — {tomorrowJobs.slice(0, 3).map((j) => j.clientName ?? j.title ?? 'Job').join(', ')}{tomorrowJobs.length > 3 ? '…' : ''}
                  {tomorrowJobs[0].address?.suburb ? ` (${tomorrowJobs[0].address.suburb})` : ''}
                </Typography>
              )}
            </SectionCard>
          </Box>
          </Stack>
        </Grid>

        {/* Money and hours */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2}>
          <Box><SectionCard title="This week’s money" subtitle={`${fmtShort(w.from)} – ${fmtShort(w.to)}`} action={<Button size="small" onClick={() => nav('/dashboard')}>Dashboard</Button>}>
            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums', color: toGo > 0 ? 'warning.main' : 'success.main' }}>{toGo > 0 ? `${money(toGo)} to go` : 'Covered'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{money(w.incomeIncludingExpected)} of the {money(w.requiredIncome)} you need this week ({money(w.incomeReceived)} received so far){toGo < 0 ? ` · ${money(-toGo)} over` : ''}</Typography>
            <LinearProgress variant="determinate" value={w.requiredIncome > 0 ? Math.min(100, (w.incomeIncludingExpected / w.requiredIncome) * 100) : 100} color={toGo > 0 ? 'warning' : 'success'} sx={{ height: 8, borderRadius: 4, mb: 1 }} aria-label="Progress to this week’s minimum income" />
            <WeekChange change={w.changeFromPrevious} previous={w.previous.income} />
            {activeGoals.length > 0 && (
              <Alert severity={toSave > 0 ? 'info' : 'success'} sx={{ mt: 1.5, py: 0.25 }} action={<Button color="inherit" size="small" onClick={() => nav('/assistant')}>Open</Button>}>
                {toSave > 0 ? <>Put <b>{money(toSave)}</b> aside this week for {activeGoals.map((g) => g.name).join(', ')}.</> : <>This week’s savings for {activeGoals.map((g) => g.name).join(', ')} are done.</>}
              </Alert>
            )}
          </SectionCard></Box>

          {h && (h.limit > 0 || h.thisWeek.total > 0) && (
            <Box>
              <SectionCard title="Work hours" subtitle={h.current ? `Fortnight ${fmtShort(h.current.from)} – ${fmtShort(h.current.to)}` : undefined} action={<Button size="small" onClick={() => nav('/hours')}>Details</Button>}>
                {h.current && (
                  <>
                    <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>{hrs(h.current.total)}{h.limit > 0 && <Typography component="span" color="text.secondary"> of {hrs(h.limit)}</Typography>}</Typography>
                    <Box sx={{ my: 1 }}><HoursBar worked={h.current.worked} scheduled={h.current.scheduled} limit={h.limit} status={h.current.status} /></Box>
                    <Typography variant="body2" color={h.current.status === 'over' ? 'error.main' : h.current.status === 'near' ? 'warning.main' : 'text.secondary'} fontWeight={h.current.status === 'ok' || h.current.status === 'none' ? 400 : 700}>
                      {h.limit <= 0 ? `${hrs(h.thisWeek.total)} this week` : h.current.over > 0 ? `${hrs(h.current.over)} over your limit` : `${hrs(h.current.remaining ?? 0)} left this fortnight · ${hrs(h.thisWeek.total)} this week`}
                    </Typography>
                  </>
                )}
              </SectionCard>
            </Box>
          )}

          <Box>
            <SectionCard title="Bills in the next 7 days" subtitle={billsSoon.length ? `${money(billsSoon.reduce((a, b) => a + b.amount, 0))} in total` : undefined} action={<Button size="small" onClick={() => nav('/bills')}>All bills</Button>} noPad={billsSoon.length > 0}>
              {!billsSoon.length ? <Typography variant="body2" color="text.secondary">Nothing due in the next week.</Typography> : billsSoon.map((b, i) => (
                <Box key={b.billId + b.dueDate}>
                  {i > 0 && <Divider />}
                  <SwipeAction label="Paid" onAction={() => payBill(b)}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{b.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{dayjs(b.dueDate).diff(dayjs(today), 'day') === 1 ? 'Tomorrow' : fmtDate(b.dueDate, 'dddd D MMM')}{b.autoPay ? ' · auto-pay' : ''}</Typography>
                      </Box>
                      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(b.amount)}</Typography>
                      <Chip size="small" variant="outlined" label="Paid" onClick={() => payBill(b)} />
                    </Stack>
                  </SwipeAction>
                </Box>
              ))}
            </SectionCard>
          </Box>
          </Stack>
        </Grid>
      </Grid>

      <Snackbar open={!!undo} autoHideDuration={6000} onClose={(_, reason) => { if (reason !== 'clickaway') setUndo(null); }} message={undo?.text}
        action={<Button color="inherit" size="small" onClick={async () => { const u = undo; setUndo(null); if (u) { try { await u.run(); await invalidate(); } catch (e) { toast((e as Error).message, 'error'); } } }}>Undo</Button>}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ mb: { xs: 9, md: 0 } }} />
    </Box>
  );
}
