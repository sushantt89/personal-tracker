import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputAdornment, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import dayjs from 'dayjs';
import { get, post } from '../api/client';
import type { Job } from '../api/types';
import { LoadingBlock } from './common';
import { fmtDate, fmtTime, localToday, money } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

const ALL = '__all__';
const hoursOf = (j: Job) => {
  if (j.hoursWorked) return j.hoursWorked;
  if (!j.startTime || !j.endTime) return 0;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let d = m(j.endTime) - m(j.startTime);
  if (d < 0) d += 24 * 60;
  return d / 60;
};
const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
const remember = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

type Mode = 'paid' | 'expected';
type Split = 'equal' | 'hours';
type ExpectedKind = 'perHour' | 'perJob' | 'total';

/**
 * Pay for jobs and shifts whose amount isn't settled yet. Two things can be done here:
 *  - "I've been paid": tick the jobs a payment covers and enter the one amount received; it is shared between them and marked as received.
 *  - "Expected pay": pencil in what you think they will pay, so the dashboard and Assistant can count it. Real pay replaces it later.
 */
export default function RecordPayDialog({ open, onClose, initialMode = 'paid' }: { open: boolean; onClose: () => void; initialMode?: Mode }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const today = localToday();
  const from = dayjs(today).subtract(120, 'day').format('YYYY-MM-DD');
  const to = dayjs(today).add(90, 'day').format('YYYY-MM-DD');
  const q = useQuery({ queryKey: ['jobs', 'pay-unset', from, to], enabled: open, queryFn: () => get<{ items: Job[] }>('/jobs', { pay: 'unset', from, to, limit: 500 }) });
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => { if (open) setMode(initialMode); }, [open, initialMode]);

  // Actual pay is for work already done; an estimate can also be put on upcoming jobs
  const all = useMemo(() => [...(q.data?.items ?? [])].filter((j) => mode === 'expected' || j.date <= today).sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? ''))), [q.data, mode, today]);
  // Who pays: the contractor for jobs done under one, otherwise the client/employer
  const payer = (j: Job) => (j.workType === 'subcontract' && j.contractorName ? j.contractorName : j.clientName ?? 'No name');
  const employers = useMemo(() => Array.from(new Set(all.map(payer))).sort(), [all]);
  const [split, setSplit] = useState<Split>(() => (remember('pt-pay-split', 'equal') === 'hours' ? 'hours' : 'equal'));
  const [kind, setKind] = useState<ExpectedKind>(() => { const k = remember('pt-expected-kind', 'perHour'); return k === 'perJob' || k === 'total' ? k : 'perHour'; });
  const [employer, setEmployer] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [value, setValue] = useState('');
  const [paidDate, setPaidDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start with the payer that has the most waiting jobs
  useEffect(() => {
    if (!open || !all.length) return;
    const first = employers.map((e) => ({ e, n: all.filter((j) => payer(j) === e).length })).sort((a, b) => b.n - a.n)[0].e;
    setEmployer((cur) => (cur === ALL || (cur && employers.includes(cur)) ? cur : first));
  }, [open, all, employers]);
  const shown = useMemo(() => (employer === ALL ? all : all.filter((j) => payer(j) === employer)), [all, employer]);
  // One payer: everything starts ticked (for an estimate, only the jobs that have no figure yet). "Everyone": start empty.
  useEffect(() => { setPicked(employer === ALL ? new Set() : new Set(shown.filter((j) => mode === 'paid' || !j.amount).map((j) => j.id))); }, [shown, employer, mode]);
  useEffect(() => { if (open) { setValue(mode === 'expected' && kind === 'perHour' ? remember('pt-expected-rate', '') : ''); setPaidDate(today); setError(null); } }, [open, today, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = shown.filter((j) => picked.has(j.id));
  const hours = chosen.reduce((a, j) => a + hoursOf(j), 0);
  const amount = Number(value);
  const valid = chosen.length > 0 && amount > 0;
  const allHaveHours = chosen.every((j) => hoursOf(j) > 0);
  const byHours = split === 'hours' && allHaveHours;
  const share = (j: Job): number | null => {
    if (!valid) return null;
    if (mode === 'paid') return byHours ? (amount * hoursOf(j)) / hours : amount / chosen.length;
    return kind === 'perHour' ? hoursOf(j) * amount : kind === 'perJob' ? amount : amount / chosen.length;
  };
  const expectedTotal = valid && mode === 'expected' ? chosen.reduce((a, j) => a + (share(j) ?? 0), 0) : 0;
  const blocked = mode === 'expected' && kind === 'perHour' && chosen.length > 0 && !allHaveHours;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (mode === 'paid') {
        const r = await post<{ updated: number }>('/jobs/record-pay', { jobIds: chosen.map((j) => j.id), total: amount, paidDate, split });
        toast(`Pay recorded for ${r.updated} job${r.updated === 1 ? '' : 's'}`);
      } else {
        const r = await post<{ updated: number; total: number }>('/jobs/expected-pay', { jobIds: chosen.map((j) => j.id), mode: kind, value: amount });
        if (kind === 'perHour') store('pt-expected-rate', value);
        toast(`Expected pay set for ${r.updated} job${r.updated === 1 ? '' : 's'} (${money(r.total)})`);
      }
      await invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === 'paid' ? 'Record pay' : 'Expected pay'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v: Mode | null) => v && setMode(v)}>
            <ToggleButton value="paid">I’ve been paid</ToggleButton>
            <ToggleButton value="expected">Set expected pay</ToggleButton>
          </ToggleButtonGroup>
          {q.isLoading ? <LoadingBlock rows={4} /> : !all.length ? (
            <Typography variant="body2" color="text.secondary">{mode === 'paid' ? 'Every job and shift up to today already has its actual pay recorded.' : 'There are no jobs waiting for pay in the next three months.'}</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {mode === 'paid'
                  ? 'Tick the jobs this payment covers and enter the total you received. It’s shared between them, replaces any estimate, and each one is marked as paid.'
                  : 'Pencil in what you expect to be paid so your dashboard and the Assistant can count it. It’s marked as an estimate; when the real pay arrives, use “I’ve been paid” and it replaces this.'}
              </Typography>
              {employers.length > 1 && (
                <TextField select label={mode === 'paid' ? 'Paid by' : 'Who pays'} value={employer} onChange={(e) => setEmployer(e.target.value)}>
                  <MenuItem value={ALL}>Everyone (pick jobs from any of them)</MenuItem>
                  {employers.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
                </TextField>
              )}
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: { xs: 'none', sm: 260 }, overflowY: 'auto' }}>
                <Stack direction="row" alignItems="center" sx={{ px: 0.5, bgcolor: 'action.hover' }}>
                  <Checkbox checked={chosen.length === shown.length && shown.length > 0} indeterminate={chosen.length > 0 && chosen.length < shown.length}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((j) => j.id)) : new Set())} slotProps={{ input: { 'aria-label': 'Select all jobs' } }} />
                  <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{employers.length > 1 ? 'Jobs waiting for pay' : `${employer} · jobs waiting for pay`}</Typography>
                </Stack>
                {shown.map((j) => (
                  <Box key={j.id}>
                    <Divider />
                    <Stack direction="row" alignItems="center" component="label" sx={{ px: 0.5, cursor: 'pointer' }}>
                      <Checkbox checked={picked.has(j.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(j.id); else n.delete(j.id); return n; })} />
                      <Box sx={{ flex: 1, minWidth: 0, py: 0.75 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{fmtDate(j.date, 'ddd D MMM')}{employer === ALL || payer(j) !== (j.clientName ?? 'No name') ? ` · ${j.clientName ?? 'No name'}` : ''}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                          {j.startTime ? `${fmtTime(j.startTime)}${j.endTime ? '–' + fmtTime(j.endTime) : ''}` : 'No time'}{hoursOf(j) ? ` · ${trim(hoursOf(j))} h` : ''}{j.date > today ? ' · upcoming' : ''}
                        </Typography>
                      </Box>
                      <Box sx={{ pr: 1.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {picked.has(j.id) && share(j) !== null
                          ? <Typography variant="body2" fontWeight={600}>{money(share(j))}</Typography>
                          : j.amount ? <Typography variant="body2" color="text.secondary">{money(j.amount)}</Typography> : null}
                        {j.amount ? <Typography variant="caption" color="text.secondary" component="div">{picked.has(j.id) && share(j) !== null ? `was ${money(j.amount)} est.` : 'expected'}</Typography> : null}
                      </Box>
                    </Stack>
                  </Box>
                ))}
              </Box>

              {mode === 'paid' ? (
                <>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Amount you were paid" type="number" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!fullScreen}
                      slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }} helperText="What reached your account (after tax)" />
                    <TextField label="Date paid" type="date" value={paidDate} onChange={(e) => e.target.value && setPaidDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  </Stack>
                  <Box>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>Share the amount</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth value={split} onChange={(_, v: Split | null) => { if (v) { setSplit(v); store('pt-pay-split', v); } }}>
                      <ToggleButton value="equal">Equally per job</ToggleButton>
                      <ToggleButton value="hours">By hours worked</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <Typography variant="body2">
                    {chosen.length} job{chosen.length === 1 ? '' : 's'}{hours > 0 ? ` · ${trim(hours)} hours` : ''}
                    {valid && !byHours ? <> · <b>{money(amount / chosen.length)}</b> each</> : null}
                    {valid && byHours && hours > 0 ? <> · works out to <b>{money(amount / hours)}</b> an hour</> : null}
                  </Typography>
                  {chosen.length > 0 && split === 'hours' && !allHaveHours && <Alert severity="info">Some of these jobs have no hours, so the amount will be shared equally between them.</Alert>}
                </>
              ) : (
                <>
                  <Box>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>The amount below is</Typography>
                    <ToggleButtonGroup exclusive size="small" fullWidth value={kind} onChange={(_, v: ExpectedKind | null) => { if (v) { setKind(v); store('pt-expected-kind', v); } }}>
                      <ToggleButton value="perHour">Per hour</ToggleButton>
                      <ToggleButton value="perJob">Per job</ToggleButton>
                      <ToggleButton value="total">Total for all</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <TextField label={kind === 'perHour' ? 'Expected pay per hour' : kind === 'perJob' ? 'Expected pay per job' : 'Expected total for the ticked jobs'} type="number" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!fullScreen}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }} helperText="Your best guess of what reaches your account" />
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2">{chosen.length} job{chosen.length === 1 ? '' : 's'}{hours > 0 ? ` · ${trim(hours)} hours` : ''}{valid && !blocked ? <> · about <b>{money(expectedTotal)}</b> expected</> : null}</Typography>
                    <Chip size="small" variant="outlined" label="Estimate" />
                  </Stack>
                  {blocked && <Alert severity="info">Some ticked jobs have no hours, so an hourly rate can’t be applied to them. Untick them, or use “Per job”.</Alert>}
                </>
              )}
              {error && <Alert severity="error">{error}</Alert>}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!valid || saving || blocked}>{saving ? 'Saving…' : mode === 'paid' ? 'Record pay' : 'Save expected pay'}</Button>
      </DialogActions>
    </Dialog>
  );
}
