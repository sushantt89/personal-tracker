import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, FormGroup, Grid, InputAdornment, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { get, patch } from '../api/client';
import type { WorkSettings } from '../api/types';
import { PageHeader, SectionCard, LoadingBlock, ErrorBlock, StatCard } from '../components/common';
import { fmtDate, fmtShort, fmtTime } from '../utils/format';
import { useToast } from '../hooks/useToast';

export interface HoursWeek { from: string; to: string; worked: number; scheduled: number; total: number; state: 'past' | 'current' | 'future' }
export interface HoursWindow { from: string; to: string; worked: number; scheduled: number; total: number; remaining: number | null; over: number; percent: number | null; status: 'ok' | 'near' | 'over' | 'none'; current: boolean; future: boolean }
export interface WorkHoursData {
  today: string; settings: WorkSettings; limit: number; weeks: HoursWeek[]; windows: HoursWindow[]; current: HoursWindow | null; roomThisWeek: number | null; thisWeek: HoursWeek;
  byEmployer: { name: string; hours: number; shifts: number }[];
  shifts: { id: string; date: string; startTime?: string; endTime?: string; hours: number; employer: string; label: string; done: boolean }[];
  warnings: HoursWindow[];
  employers: { name: string; hours: number; counted: boolean }[];
  notCounted: { hours: number; shifts: number };
}
export const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;
const TONE = { ok: 'success', near: 'warning', over: 'error', none: 'primary' } as const;
const STATUS_LABEL = { ok: 'Within limit', near: 'Close to limit', over: 'Over limit', none: 'No limit set' } as const;

/** Worked (solid) and still-scheduled (lighter) hours on one bar, measured against the limit when there is one. */
export function HoursBar({ worked, scheduled, limit, status, height = 12, max }: { worked: number; scheduled: number; limit: number; status: HoursWindow['status']; height?: number; /** draw several bars to the same scale */ max?: number }) {
  const scale = Math.max(limit, worked + scheduled, max ?? 0, 1);
  const c = TONE[status];
  return (
    <Box role="img" aria-label={`${hrs(worked)} worked, ${hrs(scheduled)} scheduled${limit ? `, limit ${hrs(limit)}` : ''}`} sx={{ position: 'relative', height, borderRadius: height / 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(worked / scale) * 100}%`, bgcolor: `${c}.main` }} />
      <Box sx={{ position: 'absolute', left: `${(worked / scale) * 100}%`, top: 0, bottom: 0, width: `${(scheduled / scale) * 100}%`, bgcolor: `${c}.main`, opacity: 0.4 }} />
      {limit > 0 && limit < scale && <Box sx={{ position: 'absolute', left: `${(limit / scale) * 100}%`, top: 0, bottom: 0, width: 2, bgcolor: 'text.primary' }} />}
    </Box>
  );
}

function WindowCard({ w, limit, title }: { w: HoursWindow; limit: number; title: string }) {
  return (
    <Box sx={{ border: 1, borderColor: w.status === 'over' ? 'error.main' : w.status === 'near' ? 'warning.main' : 'divider', borderRadius: 2, p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box>
          <Typography variant="subtitle2">{title}</Typography>
          <Typography variant="caption" color="text.secondary">{fmtShort(w.from)} – {fmtShort(w.to)}</Typography>
        </Box>
        <Chip size="small" color={TONE[w.status] === 'primary' ? 'default' : TONE[w.status]} label={STATUS_LABEL[w.status]} />
      </Stack>
      <Typography variant="h4" sx={{ mt: 1, fontVariantNumeric: 'tabular-nums' }}>{hrs(w.total)}{limit > 0 && <Typography component="span" variant="h6" color="text.secondary"> of {hrs(limit)}</Typography>}</Typography>
      <Box sx={{ my: 1 }}><HoursBar worked={w.worked} scheduled={w.scheduled} limit={limit} status={w.status} /></Box>
      <Typography variant="body2" color="text.secondary">{hrs(w.worked)} worked · {hrs(w.scheduled)} still scheduled</Typography>
      {limit > 0 && <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700, color: w.over > 0 ? 'error.main' : w.status === 'near' ? 'warning.main' : 'success.main' }}>{w.over > 0 ? `${hrs(w.over)} over the limit` : `${hrs(w.remaining ?? 0)} left`}</Typography>}
    </Box>
  );
}

const TYPES = [{ value: 'employee', label: 'Employee shifts' }, { value: 'subcontract', label: 'Work under a contractor' }, { value: 'own', label: 'Own-business jobs' }];

export default function WorkHours() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['work-hours'], queryFn: () => get<WorkHoursData>('/work-hours') });
  const [form, setForm] = useState<{ hoursLimit: string; fortnightMode: 'rolling' | 'fixed'; fortnightAnchor: string; countTypes: string[]; excludeEmployers: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data && !form) setForm({ ...q.data.settings, hoursLimit: q.data.settings.hoursLimit ? String(q.data.settings.hoursLimit) : '' }); }, [q.data, form]);
  if (q.isLoading || !form) return <LoadingBlock rows={6} height={64} />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const live = d.windows.filter((w) => w.current);
  const rolling = d.settings.fortnightMode === 'rolling';
  const weekMax = Math.max(...d.weeks.map((w) => w.total), 1);

  const save = async () => {
    setSaving(true);
    try {
      await patch('/settings', { work: { hoursLimit: Number(form.hoursLimit) || 0, fortnightMode: form.fortnightMode, fortnightAnchor: form.fortnightAnchor || '', countTypes: form.countTypes, excludeEmployers: form.excludeEmployers } });
      await Promise.all(['work-hours', 'settings', 'alerts'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast('Saved');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  };

  return (
    <Box>
      <PageHeader title="Work hours" subtitle="Hours worked and scheduled each fortnight, against a limit you set. A fortnight is two Monday-to-Sunday weeks." />
      <Grid container spacing={2}>
        {d.limit <= 0 && <Grid size={12}><Alert severity="info">No limit is set yet, so this page only adds up your hours. Enter a limit under <b>Settings</b> below to get a warning before you go over it.</Alert></Grid>}
        {d.warnings.filter((w) => w.status === 'over').map((w) => (
          <Grid key={w.from} size={12}><Alert severity="error">{hrs(w.over)} over the {hrs(d.limit)} limit in the fortnight {fmtShort(w.from)} – {fmtShort(w.to)} ({hrs(w.total)} in total). {w.scheduled > 0 ? 'Some of it is still only scheduled, so there is time to change a shift.' : ''}</Alert></Grid>
        ))}

        {d.notCounted.shifts > 0 && <Grid size={12}><Alert severity="info">{hrs(d.notCounted.hours)} in this fortnight ({d.notCounted.shifts} job{d.notCounted.shifts === 1 ? '' : 's'}) {d.notCounted.shifts === 1 ? 'is' : 'are'} left out of these totals because you chose not to count {d.notCounted.shifts === 1 ? 'it' : 'them'}. Change this under Settings below.</Alert></Grid>}
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="This week" value={hrs(d.thisWeek.total)} hint={`${hrs(d.thisWeek.worked)} worked · ${hrs(d.thisWeek.scheduled)} to come`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label={rolling ? 'Fullest fortnight' : 'This fortnight'} value={d.current ? hrs(d.current.total) : '—'} hint={d.limit > 0 ? `limit ${hrs(d.limit)}` : 'no limit set'} tone={d.current?.status === 'over' ? 'negative' : d.current?.status === 'near' ? 'warning' : 'neutral'} /></Grid>
        <Grid size={{ xs: 12, md: 6 }}><StatCard label="Room left this week" value={d.roomThisWeek === null ? '—' : hrs(d.roomThisWeek)} hint={d.roomThisWeek === null ? 'Set a limit to see this' : d.roomThisWeek > 0 ? 'More hours you could take on this week without any fortnight going over' : 'Taking on more this week would put a fortnight over the limit'} tone={d.roomThisWeek === null ? 'neutral' : d.roomThisWeek > 0 ? 'positive' : 'negative'} /></Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title={rolling ? 'Fortnights that include this week' : 'This fortnight'} subtitle={rolling ? 'Every two weeks in a row are checked, so this week counts twice: with last week and with next week' : `Fortnights run from ${fmtDate(d.settings.fortnightAnchor)}`}>
            <Grid container spacing={2}>
              {live.map((w) => <Grid key={w.from} size={{ xs: 12, sm: live.length > 1 ? 6 : 12 }}><WindowCard w={w} limit={d.limit} title={!rolling ? 'This fortnight' : w.from === d.thisWeek.from ? 'This week + next week' : 'Last week + this week'} /></Grid>)}
            </Grid>
            <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              <Stack direction="row" spacing={0.75} alignItems="center"><Box sx={{ width: 14, height: 8, borderRadius: 1, bgcolor: 'text.secondary' }} /><Typography variant="caption" color="text.secondary">Worked</Typography></Stack>
              <Stack direction="row" spacing={0.75} alignItems="center"><Box sx={{ width: 14, height: 8, borderRadius: 1, bgcolor: 'text.secondary', opacity: 0.4 }} /><Typography variant="caption" color="text.secondary">Scheduled</Typography></Stack>
              {d.limit > 0 && <Stack direction="row" spacing={0.75} alignItems="center"><Box sx={{ width: 2, height: 12, bgcolor: 'text.primary' }} /><Typography variant="caption" color="text.secondary">Limit (shown when you are over it)</Typography></Stack>}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Who the hours are for" subtitle={d.current ? `${fmtShort(d.current.from)} – ${fmtShort(d.current.to)}` : undefined}>
            {!d.byEmployer.length ? <Typography variant="body2" color="text.secondary">No hours in this fortnight yet.</Typography> : (
              <Stack divider={<Divider flexItem />} spacing={1}>
                {d.byEmployer.map((e) => (
                  <Stack key={e.name} direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="body2" noWrap>{e.name} <Typography component="span" variant="caption" color="text.secondary">· {e.shifts} shift{e.shifts === 1 ? '' : 's'}</Typography></Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{hrs(e.hours)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Week by week" subtitle="The last eight weeks and the next four">
            <Stack spacing={1}>
              {d.weeks.map((w) => (
                <Stack key={w.from} direction="row" spacing={1.5} alignItems="center" sx={{ opacity: w.total === 0 ? 0.55 : 1 }}>
                  <Typography variant="body2" sx={{ width: 112, flexShrink: 0, fontWeight: w.state === 'current' ? 700 : 400 }}>{fmtShort(w.from)} – {fmtShort(w.to)}</Typography>
                  <Box sx={{ flex: 1, minWidth: 40 }}><HoursBar worked={w.worked} scheduled={w.scheduled} limit={0} status="none" height={10} max={weekMax} /></Box>
                  <Typography variant="body2" sx={{ width: 64, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: w.state === 'current' ? 700 : 400 }}>{hrs(w.total)}</Typography>
                  <Box sx={{ width: 92, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>{w.state === 'current' && <Chip size="small" color="primary" variant="outlined" label="This week" />}</Box>
                </Stack>
              ))}
            </Stack>
            {d.limit > 0 && d.windows.some((w) => w.future && w.status !== 'ok') && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Coming up: {d.windows.filter((w) => w.future && w.status !== 'ok').map((w) => `${fmtShort(w.from)} – ${fmtShort(w.to)} is at ${hrs(w.total)}`).join('; ')}.
              </Alert>
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Shifts in this fortnight" action={<Button size="small" onClick={() => nav('/jobs?status=')}>Open Jobs</Button>}>
            {!d.shifts.length ? <Typography variant="body2" color="text.secondary">Nothing yet.</Typography> : (
              <Stack divider={<Divider flexItem />} spacing={0.75}>
                {d.shifts.map((s) => (
                  <Stack key={s.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => nav(`/jobs?focus=${s.id}`)}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>{fmtDate(s.date, 'ddd D MMM')}{s.startTime ? ` · ${fmtTime(s.startTime)}${s.endTime ? `–${fmtTime(s.endTime)}` : ''}` : ''}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">{s.employer}{s.label !== s.employer ? ` · ${s.label}` : ''}{s.done ? '' : ' · scheduled'}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', opacity: s.done ? 1 : 0.6 }}>{hrs(s.hours)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Grid>

        <Grid size={12}>
          <SectionCard title="Settings" subtitle="Hours come from each shift’s paid hours when entered, otherwise its start and finish time. Unpaid breaks are left out when the shift says so.">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField label="Limit per fortnight" type="number" value={form.hoursLimit} onChange={(e) => setForm({ ...form, hoursLimit: e.target.value })} helperText="Leave empty for no limit" slotProps={{ input: { endAdornment: <InputAdornment position="end">hours</InputAdornment> }, htmlInput: { min: 0, max: 336, step: '0.5', inputMode: 'decimal' } }} />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2">How fortnights are counted</Typography>
                <RadioGroup value={form.fortnightMode} onChange={(e) => setForm({ ...form, fortnightMode: e.target.value as 'rolling' | 'fixed' })}>
                  <FormControlLabel value="rolling" control={<Radio />} label="Any two weeks in a row (strictest)" />
                  <FormControlLabel value="fixed" control={<Radio />} label="Fixed fortnights from a start date" />
                </RadioGroup>
                {form.fortnightMode === 'fixed' && <TextField sx={{ mt: 1 }} label="A fortnight starts on" type="date" value={form.fortnightAnchor} onChange={(e) => setForm({ ...form, fortnightAnchor: e.target.value })} helperText="Any day in the first week; the Monday of that week is used" slotProps={{ inputLabel: { shrink: true } }} />}
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2">Work that counts</Typography>
                <FormGroup>
                  {TYPES.map((t) => <FormControlLabel key={t.value} control={<Checkbox checked={form.countTypes.includes(t.value)} onChange={(e) => setForm({ ...form, countTypes: e.target.checked ? [...form.countTypes, t.value] : form.countTypes.filter((x) => x !== t.value) })} />} label={t.label} />)}
                </FormGroup>
              </Grid>
              <Grid size={12}>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="subtitle2">Leave out work for (e.g. cash work)</Typography>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>Tick anyone whose hours should not be counted here. To leave out a single job instead, open it in Jobs and turn on “Don’t count this in Work hours”.</Typography>
                {!d.employers.length ? <Typography variant="body2" color="text.secondary">No work in this period yet.</Typography> : (
                  <FormGroup row>
                    {d.employers.map((e) => {
                      const off = form.excludeEmployers.some((x) => x.toLowerCase() === e.name.toLowerCase());
                      return <FormControlLabel key={e.name} sx={{ mr: 3 }} control={<Checkbox checked={off} onChange={(ev) => setForm({ ...form, excludeEmployers: ev.target.checked ? [...form.excludeEmployers, e.name] : form.excludeEmployers.filter((x) => x.toLowerCase() !== e.name.toLowerCase()) })} />}
                        label={<>{e.name} <Typography component="span" variant="caption" color="text.secondary">· {hrs(e.hours)} in the last 3 months</Typography></>} />;
                    })}
                  </FormGroup>
                )}
              </Grid>
            </Grid>
            <Button variant="contained" sx={{ mt: 2 }} onClick={save} disabled={saving || !form.countTypes.length}>{saving ? 'Saving…' : 'Save'}</Button>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>This adds up the hours you have entered here. If a limit applies to you by law or by contract, check the exact rule with whoever sets it — the app can’t know your conditions, and work you leave out here may still count under that rule.</Typography>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
