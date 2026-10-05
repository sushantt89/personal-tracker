import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, InputAdornment, Radio, RadioGroup, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { post } from '../api/client';
import type { Income } from '../api/types';
import { LoadingBlock } from './common';
import { money, fmtDate, localToday } from '../utils/format';
import { useToast } from '../hooks/useToast';

type Mode = 'asis' | 'each' | 'total';
interface Row { id: string; date: string; label: string; current: number; amount: number; hours: number; status: string; estimated: boolean; invoiced: boolean }
interface Result { rows: Row[]; count: number; total: number; currentTotal: number; split: 'hours' | 'equal' | null; perHour: number | null; skipped: { cancelled: number }; saved: boolean }
const dollars = { input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' as const } };

/**
 * Mark the selected income records as received. Asks what was actually paid:
 * the amounts already there, an amount for each record, or one total that is shared out by hours.
 */
export default function MarkIncomePaidDialog({ rows: selected, onClose }: { rows: Income[] | null; onClose: (saved: boolean) => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const open = !!selected;
  const ids = (selected ?? []).map((r) => r.id);
  const [mode, setMode] = useState<Mode>('asis');
  const [info, setInfo] = useState<Result | null>(null);
  const [each, setEach] = useState<Record<string, string>>({});
  const [total, setTotal] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [paidDate, setPaidDate] = useState(localToday());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // What is selected: current amounts, hours, and which are only estimates
  useEffect(() => {
    if (!open) return;
    setMode('asis'); setInfo(null); setPreview(null); setTotal(''); setError(''); setPaidDate(localToday());
    post<Result>('/income/bulk-pay', { ids, mode: 'asis', dryRun: true })
      .then((r) => { setInfo(r); setEach(Object.fromEntries(r.rows.map((x) => [x.id, String(x.current)]))); })
      .catch((e) => setError((e as Error).message));
  }, [open, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // One total: ask the server how it would be shared, so what is shown is exactly what gets saved
  useEffect(() => {
    if (!open || mode !== 'total' || !(Number(total) > 0)) { setPreview(null); return; }
    const t = setTimeout(() => {
      post<Result>('/income/bulk-pay', { ids, mode: 'total', total: Number(total), dryRun: true }).then((r) => { setPreview(r); setError(''); }).catch((e) => { setPreview(null); setError((e as Error).message); });
    }, 250);
    return () => clearTimeout(t);
  }, [open, mode, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimated = info?.rows.filter((r) => r.estimated).length ?? 0;
  const eachTotal = info ? info.rows.reduce((a, r) => a + (Number(each[r.id]) || 0), 0) : 0;
  const eachValid = !!info && info.rows.every((r) => Number(each[r.id]) > 0);
  const canSave = !!info && !saving && (mode === 'asis' || (mode === 'each' && eachValid) || (mode === 'total' && Number(total) > 0 && !!preview));
  const finalTotal = mode === 'asis' ? info?.currentTotal ?? 0 : mode === 'each' ? eachTotal : Number(total) || 0;

  const save = async () => {
    if (!info) return;
    setSaving(true); setError('');
    try {
      const r = await post<Result>('/income/bulk-pay', {
        ids, mode, paidDate,
        ...(mode === 'each' ? { amounts: info.rows.map((x) => ({ id: x.id, amount: Number(each[x.id]) })) } : {}),
        ...(mode === 'total' ? { total: Number(total) } : {}),
      });
      toast(`${r.count} record${r.count === 1 ? '' : 's'} marked as paid · ${money(r.total)}`);
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const shown = mode === 'total' && preview ? preview.rows : info?.rows ?? [];
  // "That makes $32.00 per hour": what the chosen amounts come to for the hours worked
  const amountOf = (r: Row) => (mode === 'each' ? Number(each[r.id]) || 0 : r.amount);
  const timed = shown.filter((r) => r.hours > 0);
  const timedHours = timed.reduce((a, r) => a + r.hours, 0);
  const timedPay = timed.reduce((a, r) => a + amountOf(r), 0);
  const hrs = (n: number) => String(Math.round(n * 100) / 100);
  const ready = mode !== 'total' || !!preview;
  return (
    <Dialog open={open} onClose={() => !saving && onClose(false)} fullWidth maxWidth="sm" fullScreen={fullScreen} scroll="paper">
      <DialogTitle>
        Mark as paid
        {info && <Typography variant="body2" color="text.secondary">{info.count} record{info.count === 1 ? '' : 's'} · currently {money(info.currentTotal)}{info.skipped.cancelled ? ` · ${info.skipped.cancelled} cancelled left out` : ''}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!info ? (error ? null : <LoadingBlock rows={4} />) : (
          <Stack spacing={2}>
            {estimated > 0 && <Alert severity="info">{estimated === info.count ? 'These are' : `${estimated} of these are`} expected amounts, not real pay yet. If you were paid something different, enter it below.</Alert>}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>What were you actually paid?</Typography>
              <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <FormControlLabel value="asis" control={<Radio />} label={<>The amounts shown are right <Typography component="span" variant="body2" color="text.secondary">({money(info.currentTotal)})</Typography></>} />
                <FormControlLabel value="each" control={<Radio />} label="Enter the actual pay for each one" />
                <FormControlLabel value="total" control={<Radio />} disabled={info.count < 2} label={<>One total for all of them <Typography component="span" variant="body2" color="text.secondary">— shared out by hours</Typography></>} />
              </RadioGroup>
            </Box>

            {mode === 'total' && (
              <Box>
                <TextField label="Total you were paid" type="number" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus slotProps={dollars} sx={{ maxWidth: 240 }} />
                {preview && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} aria-live="polite">
                    {preview.split === 'hours'
                      ? <>Shared by hours: <b>{money(preview.perHour)}</b> an hour over {preview.rows.reduce((a, r) => a + r.hours, 0).toFixed(2).replace(/\.?0+$/, '')} hours.</>
                      : <>Hours aren’t known for every record, so it is shared <b>equally</b>: about {money(preview.total / preview.count)} each.</>}
                  </Typography>
                )}
              </Box>
            )}

            <Box>
              <Stack divider={<Divider flexItem />}>
                {shown.map((r) => (
                  <Stack key={r.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{r.label}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div" noWrap>
                        {fmtDate(r.date, 'ddd D MMM')}{r.hours > 0 ? ` · ${r.hours} h` : ''}{r.hours > 0 && amountOf(r) > 0 && ready ? ` · ${money(amountOf(r) / r.hours)}/h` : ''}{r.estimated ? ' · expected' : ''}{r.status === 'paid' ? ' · already paid' : ''}{r.invoiced ? ' · on an invoice' : ''}
                      </Typography>
                    </Box>
                    {mode === 'each' ? (
                      <TextField type="number" value={each[r.id] ?? ''} onChange={(e) => setEach({ ...each, [r.id]: e.target.value })} disabled={r.invoiced} slotProps={{ ...dollars, htmlInput: { ...dollars.htmlInput, 'aria-label': `Actual pay for ${r.label} on ${fmtDate(r.date)}` } }} sx={{ width: 130, flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</Typography>
                        {mode === 'total' && preview && Math.abs(r.amount - r.current) > 0.004 && <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>{money(r.current)}</Typography>}
                      </Box>
                    )}
                  </Stack>
                ))}
              </Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between" sx={{ pt: 1 }}>
                <Typography variant="subtitle2">Total received</Typography>
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(finalTotal)}{Math.abs(finalTotal - info.currentTotal) > 0.004 && finalTotal > 0 ? ` (${finalTotal > info.currentTotal ? '+' : '−'}${money(Math.abs(finalTotal - info.currentTotal))})` : ''}</Typography>
              </Stack>
            </Box>

            {ready && timedHours > 0 && timedPay > 0 && (
              <Alert severity="success" icon={false} sx={{ py: 0.5 }} aria-live="polite">
                That makes <b>{money(timedPay / timedHours)} per hour</b> — {money(timedPay)} for {hrs(timedHours)} hour{timedHours === 1 ? '' : 's'}
                {timed.length < shown.length ? ` (the ${timed.length} of ${shown.length} records that have hours)` : ''}.
              </Alert>
            )}

            <TextField label="Date received" type="date" value={paidDate} onChange={(e) => e.target.value && setPaidDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ maxWidth: 240 }} />
            {mode !== 'asis' && <Typography variant="caption" color="text.secondary">The jobs these came from are updated to the same amounts, so they stop showing as “Expected”.</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button color="inherit" onClick={() => onClose(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Mark as paid'}</Button>
      </DialogActions>
    </Dialog>
  );
}
