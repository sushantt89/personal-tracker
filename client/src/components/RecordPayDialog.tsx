import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputAdornment, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
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

/**
 * "I've been paid": pick the jobs or shifts a payment covers and enter the one amount you received.
 * It is shared between them — equally, or by their hours — and each one's income is marked as received.
 */
export default function RecordPayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const today = localToday();
  const from = dayjs(today).subtract(120, 'day').format('YYYY-MM-DD');
  const q = useQuery({ queryKey: ['jobs', 'pay-unset', from, today], enabled: open, queryFn: () => get<{ items: Job[] }>('/jobs', { pay: 'unset', from, to: today, limit: 500 }) });
  const all = useMemo(() => [...(q.data?.items ?? [])].sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? ''))), [q.data]);
  // Who pays: the contractor for jobs done under one, otherwise the client/employer
  const payer = (j: Job) => (j.workType === 'subcontract' && j.contractorName ? j.contractorName : j.clientName ?? 'No name');
  const employers = useMemo(() => Array.from(new Set(all.map(payer))).sort(), [all]);
  const [split, setSplit] = useState<'equal' | 'hours'>(() => { try { return localStorage.getItem('pt-pay-split') === 'hours' ? 'hours' : 'equal'; } catch { return 'equal'; } });
  const chooseSplit = (v: 'equal' | 'hours') => { setSplit(v); try { localStorage.setItem('pt-pay-split', v); } catch { /* private mode */ } };
  const [employer, setEmployer] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState('');
  const [paidDate, setPaidDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start with the employer that has the most waiting shifts, all of them ticked
  useEffect(() => {
    if (!open || !all.length) return;
    const first = employers.map((e) => ({ e, n: all.filter((j) => payer(j) === e).length })).sort((a, b) => b.n - a.n)[0].e;
    setEmployer((cur) => (cur === ALL || (cur && employers.includes(cur)) ? cur : first));
  }, [open, all, employers]);
  const shown = useMemo(() => (employer === ALL ? all : all.filter((j) => payer(j) === employer)), [all, employer]);
  // One payer: everything starts ticked. "Everyone": start empty and tick the jobs this payment covers.
  useEffect(() => { setPicked(employer === ALL ? new Set() : new Set(shown.map((j) => j.id))); }, [shown, employer]);
  useEffect(() => { if (open) { setTotal(''); setPaidDate(today); setError(null); } }, [open, today]);

  const chosen = shown.filter((j) => picked.has(j.id));
  const hours = chosen.reduce((a, j) => a + hoursOf(j), 0);
  const amount = Number(total);
  const valid = chosen.length > 0 && amount > 0;
  const allHaveHours = chosen.every((j) => hoursOf(j) > 0);
  const byHours = split === 'hours' && allHaveHours;
  const share = (j: Job) => (!valid ? null : byHours ? (amount * hoursOf(j)) / hours : amount / chosen.length);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await post<{ updated: number }>('/jobs/record-pay', { jobIds: chosen.map((j) => j.id), total: amount, paidDate, split });
      await invalidate();
      toast(`Pay recorded for ${r.updated} job${r.updated === 1 ? '' : 's'}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>Record pay</DialogTitle>
      <DialogContent dividers>
        {q.isLoading ? <LoadingBlock rows={4} /> : !all.length ? (
          <Typography variant="body2" color="text.secondary">Every job and shift up to today already has its pay recorded.</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">Tick the jobs this payment covers and enter the total you received. It’s shared between them and each one is marked as paid.</Typography>
            {employers.length > 1 && (
              <TextField select label="Paid by" value={employer} onChange={(e) => setEmployer(e.target.value)}>
                <MenuItem value={ALL}>Everyone (pick jobs from any of them)</MenuItem>
                {employers.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
              </TextField>
            )}
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: { xs: 'none', sm: 280 }, overflowY: 'auto' }}>
              <Stack direction="row" alignItems="center" sx={{ px: 0.5, bgcolor: 'action.hover' }}>
                <Checkbox checked={chosen.length === shown.length && shown.length > 0} indeterminate={chosen.length > 0 && chosen.length < shown.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((j) => j.id)) : new Set())} slotProps={{ input: { 'aria-label': 'Select all shifts' } }} />
                <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{employers.length > 1 ? 'Jobs waiting for pay' : `${employer} · jobs waiting for pay`}</Typography>
              </Stack>
              {shown.map((j) => (
                <Box key={j.id}>
                  <Divider />
                  <Stack direction="row" alignItems="center" component="label" sx={{ px: 0.5, cursor: 'pointer' }}>
                    <Checkbox checked={picked.has(j.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(j.id); else n.delete(j.id); return n; })} />
                    <Box sx={{ flex: 1, minWidth: 0, py: 0.75 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>{fmtDate(j.date, 'ddd D MMM')}{employer === ALL || payer(j) !== (j.clientName ?? 'No name') ? ` · ${j.clientName ?? 'No name'}` : ''}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">{j.startTime ? `${fmtTime(j.startTime)}${j.endTime ? '–' + fmtTime(j.endTime) : ''}` : 'No time'}{j.address?.suburb ? ` · ${j.address.suburb}` : ''}</Typography>
                    </Box>
                    <Box sx={{ pr: 1.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {picked.has(j.id) && share(j) !== null && <Typography variant="body2" fontWeight={600}>{money(share(j))}</Typography>}
                      <Typography variant="caption" color="text.secondary">{hoursOf(j) ? `${hoursOf(j).toFixed(2).replace(/\.?0+$/, '')} h` : ''}</Typography>
                    </Box>
                  </Stack>
                </Box>
              ))}
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Amount you were paid" type="number" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus={!fullScreen}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }} helperText="What reached your account (after tax)" />
              <TextField label="Date paid" type="date" value={paidDate} onChange={(e) => e.target.value && setPaidDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>Share the amount</Typography>
              <ToggleButtonGroup exclusive size="small" fullWidth value={split} onChange={(_, v: 'equal' | 'hours' | null) => v && chooseSplit(v)}>
                <ToggleButton value="equal">Equally per job</ToggleButton>
                <ToggleButton value="hours">By hours worked</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Typography variant="body2">
              {chosen.length} job{chosen.length === 1 ? '' : 's'}{hours > 0 ? ` · ${hours.toFixed(2).replace(/\.?0+$/, '')} hours` : ''}
              {valid && !byHours ? <> · <b>{money(amount / chosen.length)}</b> each</> : null}
              {valid && byHours && hours > 0 ? <> · works out to <b>{money(amount / hours)}</b> an hour</> : null}
            </Typography>
            {chosen.length > 0 && split === 'hours' && !allHaveHours && <Alert severity="info">Some of these jobs have no hours, so the amount will be shared equally between them.</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!valid || saving}>{saving ? 'Saving…' : 'Record pay'}</Button>
      </DialogActions>
    </Dialog>
  );
}
