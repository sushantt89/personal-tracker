import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Collapse, Divider, FormControlLabel, Grid, IconButton, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import dayjs from 'dayjs';
import { fileUrl, get, patch, post } from '../api/client';
import { PageHeader, SectionCard, LoadingBlock, ErrorBlock, StatCard, EmptyState } from '../components/common';
import { money, fmtDate, localToday } from '../utils/format';
import { useToast } from '../hooks/useToast';

interface Leg { from: string; to: string; km: number; home: boolean; counted: boolean }
interface Row { date: string; stops: number; betweenKm: number; homeKm: number; totalKm: number; countedKm: number; legs: Leg[]; problem: string }
interface Log {
  fy: { start: number; label: string; from: string; to: string };
  settings: { enabled: boolean; homeSet: boolean; ratePerKm: number; logCount: 'between' | 'all' };
  totals: { days: number; countedKm: number; betweenKm: number; homeKm: number; claimKm: number; capKm: number; overCap: boolean; estimate: number };
  months: { month: string; days: number; countedKm: number; betweenKm: number; homeKm: number }[];
  rows: Row[]; daysWithoutRoute: number;
}
const km = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-AU')} km`;
const currentFy = () => { const t = localToday(); return Number(t.slice(5, 7)) >= 7 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1; };

export default function Kilometres() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [fy, setFy] = useState(currentFy());
  const q = useQuery({ queryKey: ['travel', 'logbook', fy], queryFn: () => get<Log>('/travel/logbook', { fy }) });
  const [rate, setRate] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (q.data) setRate(String(q.data.settings.ratePerKm)); }, [q.data?.settings.ratePerKm]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <LoadingBlock rows={6} height={64} />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const refresh = () => Promise.all(['travel', 'settings'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const saveSetting = async (travel: Record<string, unknown>) => {
    try { await patch('/settings', { travel }); await refresh(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  // Work out routes for days in this year that don't have one yet (a batch at a time)
  const calculate = async () => {
    setBusy(true);
    try {
      let done = 0;
      for (let i = 0; i < 8; i++) {
        const r = await post<{ calculated: number; remaining: number }>('/travel/backfill', { from: d.fy.from, to: d.fy.to < localToday() ? d.fy.to : localToday() });
        done += r.calculated;
        if (!r.remaining || !r.calculated) break;
      }
      await refresh();
      toast(done ? `Worked out ${done} day${done === 1 ? '' : 's'}` : 'Nothing new to work out');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const monthMax = Math.max(...d.months.map((m) => m.countedKm), 1);

  return (
    <Box>
      <PageHeader title="Kilometre log" subtitle="Driving for work across the financial year, from the routes between your jobs."
        actions={<Button startIcon={<DownloadIcon />} href={fileUrl('/travel/logbook', { fy, format: 'csv' })} disabled={!d.rows.length}>Download CSV</Button>} />

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton aria-label="Previous financial year" onClick={() => setFy(fy - 1)}><ChevronLeftIcon /></IconButton>
        <Box sx={{ textAlign: 'center', minWidth: 190 }}>
          <Typography variant="subtitle1" fontWeight={700}>Financial year {d.fy.label}</Typography>
          <Typography variant="caption" color="text.secondary">{fmtDate(d.fy.from)} – {fmtDate(d.fy.to)}</Typography>
        </Box>
        <IconButton aria-label="Next financial year" onClick={() => setFy(fy + 1)} disabled={fy >= currentFy()}><ChevronRightIcon /></IconButton>
      </Stack>

      <Grid container spacing={2}>
        {!d.settings.enabled && <Grid size={12}><Alert severity="info" action={<Button color="inherit" size="small" onClick={() => nav('/settings?tab=travel')}>Open Settings</Button>}>Distance &amp; travel is turned off, so no driving is being recorded. Turn it on in Settings → Travel and add your home address.</Alert></Grid>}
        {d.settings.enabled && d.daysWithoutRoute > 0 && (
          <Grid size={12}><Alert severity="warning" action={<Button color="inherit" size="small" onClick={calculate} disabled={busy}>{busy ? 'Working…' : 'Work them out'}</Button>}>{d.daysWithoutRoute} day{d.daysWithoutRoute === 1 ? '' : 's'} with jobs {d.daysWithoutRoute === 1 ? 'has' : 'have'} no driving worked out yet, so {d.daysWithoutRoute === 1 ? 'it is' : 'they are'} missing from the totals.</Alert></Grid>
        )}

        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Kilometres counted" value={km(d.totals.countedKm)} hint={d.settings.logCount === 'all' ? 'including trips from and to home' : 'driving between jobs'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Estimate" value={money(d.totals.estimate)} hint={`${km(d.totals.claimKm)} × ${money(d.settings.ratePerKm)} per km`} tone="positive" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Days driven" value={d.totals.days} hint={d.totals.days ? `${km(d.totals.countedKm / d.totals.days)} a day on average` : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Home trips" value={km(d.totals.homeKm)} hint={d.settings.logCount === 'all' ? 'counted' : 'not counted'} /></Grid>

        {d.totals.overCap && <Grid size={12}><Alert severity="info">You are past {d.totals.capKm.toLocaleString('en-AU')} km. The simple cents-per-kilometre method only covers the first {d.totals.capKm.toLocaleString('en-AU')} km, so the estimate stops there — a logbook method may suit you better. Ask a tax agent.</Alert></Grid>}

        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2}>
          <Box><SectionCard title="By month">
            {!d.months.length ? <Typography variant="body2" color="text.secondary">No driving recorded in this year yet.</Typography> : (
              <Stack spacing={1}>
                {d.months.map((m) => (
                  <Stack key={m.month} direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="body2" sx={{ width: 68, flexShrink: 0 }}>{dayjs(m.month + '-01').format('MMM YY')}</Typography>
                    <Box sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }} role="img" aria-label={`${km(m.countedKm)} in ${dayjs(m.month + '-01').format('MMMM YYYY')}`}><Box sx={{ width: `${(m.countedKm / monthMax) * 100}%`, height: '100%', bgcolor: 'primary.main' }} /></Box>
                    <Typography variant="body2" sx={{ width: 84, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{km(m.countedKm)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard></Box>
          <Box>
            <SectionCard title="Settings">
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField label="Rate per kilometre" type="number" value={rate} onChange={(e) => setRate(e.target.value)} sx={{ maxWidth: 200 }} helperText="The tax office sets this each year — check the current figure"
                    slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, max: 10, step: '0.01', inputMode: 'decimal' } }} />
                  <Button variant="outlined" sx={{ mt: 0.25 }} disabled={rate === '' || Number(rate) === d.settings.ratePerKm} onClick={() => saveSetting({ ratePerKm: Number(rate) })}>Save</Button>
                </Stack>
                <FormControlLabel control={<Switch checked={d.settings.logCount === 'all'} onChange={(e) => saveSetting({ logCount: e.target.checked ? 'all' : 'between' })} />} label="Also count trips from home to the first job and back home" />
                <Typography variant="caption" color="text.secondary">Driving between home and work usually can’t be claimed, which is why those trips are left out unless you turn this on. This page is a record to check against the tax office’s rules or give to a tax agent — it isn’t tax advice.</Typography>
              </Stack>
            </SectionCard>
          </Box>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Day by day" subtitle="Tap a day to see each trip" noPad>
            {!d.rows.length ? <EmptyState title="No driving recorded" message={d.settings.enabled ? 'Days with jobs at known addresses show up here.' : 'Turn on Distance & travel in Settings first.'} /> : d.rows.slice(0, showAll ? undefined : 14).map((r, i) => (
              <Box key={r.date}>
                {i > 0 && <Divider />}
                <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, minHeight: 52, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }} role="button" tabIndex={0} aria-expanded={open === r.date}
                  onClick={() => setOpen(open === r.date ? null : r.date)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === r.date ? null : r.date); } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>{fmtDate(r.date, 'ddd D MMM YYYY')}</Typography>
                    <Typography variant="caption" color={r.problem ? 'warning.main' : 'text.secondary'}>{r.stops} job{r.stops === 1 ? '' : 's'}{r.homeKm > 0 ? ` · ${km(r.homeKm)} home trips` : ''}{r.problem ? ` · ${r.problem}` : ''}</Typography>
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{km(r.countedKm)}</Typography>
                  <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', transform: open === r.date ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                </Stack>
                <Collapse in={open === r.date} unmountOnExit>
                  <Stack spacing={0.5} sx={{ px: 2, pb: 1.5 }}>
                    {r.legs.map((l, j) => (
                      <Stack key={j} direction="row" justifyContent="space-between" spacing={1} sx={{ opacity: l.counted ? 1 : 0.6 }}>
                        <Typography variant="body2" noWrap>{l.from} → {l.to}{l.counted ? '' : ' (not counted)'}</Typography>
                        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{km(l.km)}</Typography>
                      </Stack>
                    ))}
                    <Box><Button size="small" onClick={() => nav(`/my-day?date=${r.date}`)}>Open this day</Button></Box>
                  </Stack>
                </Collapse>
              </Box>
            ))}
            {d.rows.length > 14 && <><Divider /><Box sx={{ p: 1, textAlign: 'center' }}><Button size="small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${d.rows.length} days`}</Button></Box></>}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
