import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Chip, Collapse, Divider, Grid, IconButton, InputAdornment, LinearProgress, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import dayjs from 'dayjs';
import { api, del, get, post } from '../api/client';
import { SectionCard, LoadingBlock, useConfirm } from './common';
import { money, fmtDate, fmtShort, localToday } from '../utils/format';
import { useToast } from '../hooks/useToast';

type Tone = 'pass' | 'warn' | 'fail';
interface GoalWeek { from: string; to: string; planned: number; saved: number; state: 'past' | 'current' | 'future' }
interface Goal {
  id: string; name: string; target: number; dueDate: string; saved: number; remaining: number; percent: number;
  status: 'done' | 'overdue' | 'on_track' | 'ahead' | 'behind'; weeksLeft: number; originalPerWeek: number;
  thisWeek: { from: string; to: string; needed: number; saved: number; stillToPut: number; aheadBy: number };
  perWeekAfterThis: number;
  thisMonth: { needed: number; saved: number; stillToPut: number };
  weeks: GoalWeek[];
  contributions: { id: string; date: string; amount: number }[];
  messages: { status: Tone; text: string }[];
}
interface Earn { normal: number; goals: number; total: number; soFar: number; toGo: number }
interface GoalsOverview {
  goals: Goal[]; earn: { week: Earn; month: Earn };
  spare: { amount: number; received: number; spent: number; stillToPut: number };
  capacity: { status: Tone; text: string } | null;
}
const sev = (t: Tone) => (t === 'pass' ? 'success' : t === 'warn' ? 'warning' : 'error');
const STATUS: Record<Goal['status'], { label: string; color: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  done: { label: 'Reached', color: 'success' }, overdue: { label: 'Date passed', color: 'error' }, on_track: { label: 'On track', color: 'info' }, ahead: { label: 'Ahead', color: 'success' }, behind: { label: 'Catching up', color: 'warning' },
};
const dollars = { input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' as const } };

function EarnLine({ label, e }: { label: string; e: Earn }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</Typography>
      <Typography variant="h5" color={e.toGo > 0 ? 'warning.main' : 'success.main'} sx={{ fontVariantNumeric: 'tabular-nums' }}>{e.toGo > 0 ? `${money(e.toGo)} to go` : 'Covered'}</Typography>
      <Typography variant="body2" color="text.secondary">
        Need {money(e.total)} = {money(e.normal)} normal costs + {money(e.goals)} for your goals. {money(e.soFar)} received or expected so far.
      </Typography>
    </Box>
  );
}

function GoalCard({ g, spare, onChange }: { g: Goal; spare: number; onChange: (o: GoalsOverview) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<{ status: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWeeks, setShowWeeks] = useState(false);
  const active = g.status !== 'done' && g.status !== 'overdue';
  const st = STATUS[g.status];

  // Show what an amount would do to the plan before it is saved
  useEffect(() => {
    const n = Number(amount);
    if (!(n > 0)) { setPreview(null); return; }
    const t = setTimeout(() => { post<{ status: Tone; text: string }>(`/assistant/goals/${g.id}/preview`, { amount: n }).then(setPreview).catch(() => setPreview(null)); }, 250);
    return () => clearTimeout(t);
  }, [amount, g.id, g.remaining]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!(Number(amount) > 0)) return;
    setBusy(true);
    try { onChange(await post<GoalsOverview>(`/assistant/goals/${g.id}/contributions`, { amount: Number(amount) })); setAmount(''); toast(`${money(Number(amount))} added to ${g.name}`); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const removeEntry = async (id: string) => {
    try { onChange(await del<GoalsOverview>(`/assistant/goals/${g.id}/contributions/${id}`)); } catch (err) { toast((err as Error).message, 'error'); }
  };
  const removeGoal = async () => {
    if (!(await confirm({ title: `Remove “${g.name}”?`, message: 'The goal and its record of what you put aside are deleted. Your money isn’t touched.', confirmText: 'Remove', danger: true }))) return;
    try { onChange(await del<GoalsOverview>(`/assistant/goals/${g.id}`)); } catch (err) { toast((err as Error).message, 'error'); }
  };

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" fontWeight={700}>{g.name}</Typography>
            <Chip size="small" color={st.color} label={st.label} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{money(g.target)} by {fmtDate(g.dueDate, 'ddd D MMM YYYY')}{active ? ` · ${g.weeksLeft} week${g.weeksLeft === 1 ? '' : 's'} left` : ''}</Typography>
        </Box>
        <Tooltip title="Remove goal"><IconButton size="small" aria-label={`Remove ${g.name}`} onClick={removeGoal}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>

      <Box sx={{ mt: 1.5 }}>
        <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={600}>{money(g.saved)} saved</Typography><Typography variant="body2" color="text.secondary">{money(g.remaining)} to go</Typography></Stack>
        <LinearProgress variant="determinate" value={g.percent} color={g.status === 'done' ? 'success' : 'primary'} sx={{ height: 8, borderRadius: 4, mt: 0.5 }} aria-label={`${g.percent}% saved`} />
      </Box>

      {active && (
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          {[
            { label: 'Still to put in this week', big: g.thisWeek.stillToPut > 0 ? money(g.thisWeek.stillToPut) : 'Done', small: g.thisWeek.saved > 0 ? `${money(g.thisWeek.saved)} of ${money(g.thisWeek.needed)} put in` : `${fmtShort(g.thisWeek.from)} – ${fmtShort(g.thisWeek.to)}` },
            { label: 'Still to put in this month', big: g.thisMonth.stillToPut > 0 ? money(g.thisMonth.stillToPut) : 'Done', small: `${money(g.thisMonth.saved)} of ${money(g.thisMonth.needed)} put in` },
            { label: 'Each week after', big: g.weeksLeft > 1 ? money(g.weeks.find((w) => w.state === 'future')?.planned ?? 0) : '—', small: g.weeksLeft > 1 ? `for ${g.weeksLeft - 1} more week${g.weeksLeft - 1 === 1 ? '' : 's'}` : 'this is the last week' },
          ].map((x) => (
            <Grid key={x.label} size={{ xs: 12, sm: 4 }}>
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.25, height: '100%' }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{x.label}</Typography>
                <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>{x.big}</Typography>
                <Typography variant="caption" color="text.secondary">{x.small}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}

      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {g.messages.map((m, i) => <Alert key={i} severity={sev(m.status)} sx={{ py: 0.25 }}>{m.text}</Alert>)}
      </Stack>

      {active && (
        <Box component="form" onSubmit={add} sx={{ mt: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Put money aside</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} slotProps={dollars} sx={{ maxWidth: { sm: 180 } }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
              {g.thisWeek.stillToPut > 0 && <Chip label={`Needed ${money(g.thisWeek.stillToPut)}`} onClick={() => setAmount(String(g.thisWeek.stillToPut))} variant="outlined" />}
              {spare > 0 && Math.abs(spare - g.thisWeek.stillToPut) > 0.5 && <Chip label={`All spare ${money(Math.min(spare, g.remaining))}`} onClick={() => setAmount(String(Math.min(spare, g.remaining)))} variant="outlined" />}
            </Stack>
            <Button type="submit" variant="contained" disabled={busy || !(Number(amount) > 0)} sx={{ whiteSpace: 'nowrap' }}>{busy ? 'Saving…' : 'Add to savings'}</Button>
          </Stack>
          {preview && <Alert severity={sev(preview.status)} sx={{ mt: 1, py: 0.25 }} aria-live="polite">{preview.text}</Alert>}
        </Box>
      )}

      <Button size="small" color="inherit" endIcon={<ExpandMoreIcon sx={{ transform: showWeeks ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />} onClick={() => setShowWeeks((v) => !v)} sx={{ mt: 1, color: 'text.secondary' }}>
        {showWeeks ? 'Hide' : 'Show'} week-by-week plan{g.contributions.length ? ` and ${g.contributions.length} entr${g.contributions.length === 1 ? 'y' : 'ies'}` : ''}
      </Button>
      <Collapse in={showWeeks} unmountOnExit>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {g.weeks.map((w) => {
            const diff = Math.round((w.saved - w.planned) * 100) / 100;
            return (
              <Stack key={w.from} direction="row" spacing={1} alignItems="center" sx={{ opacity: w.state === 'future' ? 0.75 : 1 }}>
                <Typography variant="body2" sx={{ width: 118, flexShrink: 0, fontWeight: w.state === 'current' ? 700 : 400 }}>{fmtShort(w.from)} – {fmtShort(w.to)}</Typography>
                <Typography variant="body2" sx={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {w.state === 'future' ? `${money(w.planned)} planned` : `${money(w.saved)} of ${money(w.planned)}`}
                </Typography>
                {w.state === 'current' ? <Chip size="small" label="This week" color="primary" variant="outlined" />
                  : w.state === 'past' ? <Chip size="small" variant="outlined" color={diff >= -0.5 ? 'success' : 'warning'} label={diff > 0.5 ? `${money(diff)} extra` : diff < -0.5 ? `${money(-diff)} short` : 'Done'} /> : null}
              </Stack>
            );
          })}
        </Stack>
        {g.contributions.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">What you’ve put in</Typography>
            {g.contributions.map((c) => (
              <Stack key={c.id} direction="row" alignItems="center" spacing={1}>
                <Typography variant="body2" sx={{ flex: 1 }}>{fmtDate(c.date, 'ddd D MMM')} · <b>{money(c.amount)}</b></Typography>
                <Tooltip title="Remove this entry"><IconButton size="small" aria-label={`Remove ${money(c.amount)} from ${fmtDate(c.date)}`} onClick={() => removeEntry(c.id)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            ))}
          </>
        )}
      </Collapse>
    </Box>
  );
}

/** "I need $X by this date": a weekly plan that adjusts itself to what you actually manage to put aside. */
export default function SavingGoals() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['assistant', 'goals'], queryFn: () => get<GoalsOverview>('/assistant/goals') });
  const setData = (o: GoalsOverview) => { qc.setQueryData(['assistant', 'goals'], o); qc.invalidateQueries({ queryKey: ['assistant', 'overview'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); };
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', target: '', dueDate: dayjs(localToday()).add(2, 'month').format('YYYY-MM-DD'), alreadySaved: '' });
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setData(await api<GoalsOverview>('/assistant/goals', { method: 'POST', body: { name: form.name.trim(), target: Number(form.target), dueDate: form.dueDate, alreadySaved: form.alreadySaved === '' ? undefined : Number(form.alreadySaved) } }));
      setAdding(false); setForm({ ...form, name: '', target: '', alreadySaved: '' });
      toast('Goal added');
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const o = q.data;
  const hasActive = !!o?.goals.some((g) => g.status !== 'done' && g.status !== 'overdue');

  return (
    <SectionCard title="Saving up for something" subtitle="Tell me what you need and by when. I’ll work out what to earn and what to put aside each week, and adjust as you go."
      action={!adding && <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>New goal</Button>}>
      {q.isLoading ? <LoadingBlock rows={3} /> : (
        <Stack spacing={2}>
          <Collapse in={adding} unmountOnExit>
            <Box component="form" onSubmit={create} sx={{ border: 1, borderColor: 'primary.main', borderRadius: 2, p: 2 }}>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="What are you saving for?" placeholder="e.g. Semester fee" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus slotProps={{ htmlInput: { maxLength: 120 } }} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="How much do you need?" type="number" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required slotProps={dollars} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Needed by" type="date" value={form.dueDate} onChange={(e) => e.target.value && setForm({ ...form, dueDate: e.target.value })} required slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localToday() } }} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Already put aside (optional)" type="number" value={form.alreadySaved} onChange={(e) => setForm({ ...form, alreadySaved: e.target.value })} slotProps={dollars} /></Grid>
              </Grid>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Button type="submit" variant="contained" disabled={busy || !form.name.trim() || !(Number(form.target) > 0)}>{busy ? 'Adding…' : 'Make the plan'}</Button>
                <Button color="inherit" onClick={() => setAdding(false)}>Cancel</Button>
              </Stack>
            </Box>
          </Collapse>

          {!o?.goals.length && !adding && (
            <Typography variant="body2" color="text.secondary">No goals yet. Add one — a fee, a bond, a trip — and you’ll get a weekly amount to put aside, plus how much you need to earn to manage it.</Typography>
          )}

          {o && hasActive && (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} divider={<Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' } }} />}>
                <EarnLine label="To earn this week" e={o.earn.week} />
                <EarnLine label="To earn this month" e={o.earn.month} />
              </Stack>
              {o.capacity && <Alert severity={sev(o.capacity.status)}>{o.capacity.text}</Alert>}
            </>
          )}

          {o?.goals.map((g) => <GoalCard key={g.id} g={g} spare={o.spare.amount} onChange={setData} />)}
        </Stack>
      )}
    </SectionCard>
  );
}
