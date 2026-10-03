import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Chip, Divider, Grid, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography, alpha, useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { del, get, post, put } from '../api/client';
import { PageHeader, SectionCard, LoadingBlock, ErrorBlock, useConfirm } from '../components/common';
import { money, fmtDate, fmtShort } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import SavingGoals from '../components/SavingGoals';

type Verdict = 'yes' | 'tight' | 'wait' | 'no' | 'unknown';
interface Check { key: string; status: 'pass' | 'warn' | 'fail'; title: string; detail: string }
interface Afford { name: string | null; amount: number; verdict: Verdict; headline: string; summary: string; checks: Check[]; affordableFrom: string | null; facts: { label: string; value: string }[]; suggestions: string[] }
interface Overview {
  today: string;
  balance: { amount: number; known: boolean; enteredAmount?: number; asOf?: string; incomeSince: number; expensesSince: number };
  safeToSpend: { amount: number; beforeSavings: number; perDay: number; incomeExpected: number; billsDue: number; everyday: number; everydaySource: 'budget' | 'average' | 'none'; savingsTarget: number; goals: number; days: number };
  notes: { status: 'pass' | 'warn' | 'fail'; text: string }[];
  week: { bills: { name: string; amount: number; dueDate: string }[]; income: { label: string; amount: number; date: string }[]; jobs: number; jobHours: number; jobIncome: number };
  workNeeded: { shortfall: number; avgPerHour: number; hours: number | null; requiredIncome: number; incomeIncludingExpected: number };
  topCategories: { name: string; thisMonth: number; lastMonth: number }[];
  averages: { monthlyIncome: number; monthlyExpenses: number };
}
interface Wish { id: string; name: string; amount: number; status: 'wanted' | 'bought'; boughtDate?: string; verdict: Verdict | null; headline: string | null; affordableFrom: string | null }

const VERDICT: Record<Verdict, { color: 'success' | 'warning' | 'error' | 'info'; label: string; icon: ReactNode }> = {
  yes: { color: 'success', label: 'Yes', icon: <CheckCircleIcon /> },
  tight: { color: 'warning', label: 'Yes, but tight', icon: <WarningAmberRoundedIcon /> },
  wait: { color: 'info', label: 'Wait', icon: <HourglassBottomIcon /> },
  no: { color: 'error', label: 'Not now', icon: <ErrorIcon /> },
  unknown: { color: 'info', label: 'Need more info', icon: <HelpOutlineIcon /> },
};
const statusIcon = (s: 'pass' | 'warn' | 'fail') =>
  s === 'pass' ? <CheckCircleIcon color="success" fontSize="small" /> : s === 'warn' ? <WarningAmberRoundedIcon color="warning" fontSize="small" /> : <ErrorIcon color="error" fontSize="small" />;

const MoneyInput = ({ label, value, onChange, helper, autoFocus }: { label: string; value: string; onChange: (v: string) => void; helper?: string; autoFocus?: boolean }) => (
  <TextField label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} helperText={helper} autoFocus={autoFocus}
    slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }} />
);
const Row = ({ label, value, strong, sign }: { label: ReactNode; value: number; strong?: boolean; sign?: '+' | '−' }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'} fontWeight={strong ? 700 : 400}>{label}</Typography>
    <Typography variant="body2" fontWeight={strong ? 700 : 500} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{sign ? `${sign} ` : ''}{money(Math.abs(value))}</Typography>
  </Stack>
);

export default function Assistant() {
  const theme = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const overview = useQuery({ queryKey: ['assistant', 'overview'], queryFn: () => get<Overview>('/assistant/overview') });
  const wishlist = useQuery({ queryKey: ['assistant', 'wishlist'], queryFn: () => get<{ items: Wish[] }>('/assistant/wishlist') });
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['assistant'] }), invalidate()]); };

  // Balance
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const saveBalance = async (e: FormEvent) => {
    e.preventDefault();
    if (balanceInput === '') return;
    try {
      qc.setQueryData(['assistant', 'overview'], await put<Overview>('/assistant/balance', { amount: Number(balanceInput) }));
      setEditingBalance(false); setBalanceInput(''); setResult(null);
      qc.invalidateQueries({ queryKey: ['assistant', 'wishlist'] });
      toast('Balance updated');
    } catch (err) { toast((err as Error).message, 'error'); }
  };

  // Should I buy it?
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Afford | null>(null);
  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (!(Number(amount) > 0)) return;
    setChecking(true);
    try { setResult(await post<Afford>('/assistant/afford', { amount: Number(amount), name: name.trim() || undefined })); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setChecking(false); }
  };
  const addWish = async () => {
    if (!result) return;
    try {
      await post('/assistant/wishlist', { name: name.trim() || 'Something I want', amount: result.amount });
      await qc.invalidateQueries({ queryKey: ['assistant', 'wishlist'] });
      toast('Added to your wishlist');
    } catch (err) { toast((err as Error).message, 'error'); }
  };
  const buyWish = async (w: Wish) => {
    if (!(await confirm({ title: `Bought “${w.name}”?`, message: `This records a ${money(w.amount)} expense dated today and ticks it off your wishlist.`, confirmText: 'Yes, I bought it' }))) return;
    try { await post(`/assistant/wishlist/${w.id}/buy`, {}); await refresh(); setResult(null); toast('Recorded as an expense'); } catch (err) { toast((err as Error).message, 'error'); }
  };
  const removeWish = async (w: Wish) => {
    try { await del(`/assistant/wishlist/${w.id}`); await qc.invalidateQueries({ queryKey: ['assistant', 'wishlist'] }); } catch (err) { toast((err as Error).message, 'error'); }
  };

  if (overview.isLoading) return <LoadingBlock rows={6} />;
  if (overview.error || !overview.data) return <ErrorBlock error={overview.error} onRetry={overview.refetch} />;
  const o = overview.data;
  const v = result ? VERDICT[result.verdict] : null;
  const wanted = (wishlist.data?.items ?? []).filter((w) => w.status === 'wanted');
  const bought = (wishlist.data?.items ?? []).filter((w) => w.status === 'bought').slice(0, 3);

  return (
    <Box>
      <PageHeader title="Assistant" subtitle="Straight answers worked out from your own income, bills and spending. A guide from your numbers — not financial advice." />
      <Grid container spacing={2}>
        {/* What you have, and what is free to spend */}
        <Grid size={{ xs: 12, md: 5 }}>
          <SectionCard title="Money I have right now" subtitle={o.balance.known ? `You entered ${money(o.balance.enteredAmount)} on ${fmtDate(o.balance.asOf)}` : 'Not entered yet — using what’s left of this month’s income'}
            action={!editingBalance && <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => { setBalanceInput(String(o.balance.amount)); setEditingBalance(true); }}>{o.balance.known ? 'Update' : 'Enter'}</Button>}>
            {editingBalance ? (
              <Stack component="form" onSubmit={saveBalance} spacing={1.5}>
                <MoneyInput label="What’s in your account today" value={balanceInput} onChange={setBalanceInput} autoFocus helper="Check your bank app. After this, income and expenses you record adjust it automatically." />
                <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={balanceInput === ''}>Save</Button><Button color="inherit" onClick={() => setEditingBalance(false)}>Cancel</Button></Stack>
              </Stack>
            ) : (
              <>
                <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(o.balance.amount)}</Typography>
                {o.balance.known && (o.balance.incomeSince > 0 || o.balance.expensesSince > 0) && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>Since then: + {money(o.balance.incomeSince)} received, − {money(o.balance.expensesSince)} spent. If this doesn’t match your bank, tap Update.</Typography>
                )}
              </>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <SectionCard title={`Safe to spend · next ${o.safeToSpend.days} days`} subtitle="What’s left after bills, everyday costs, your savings target and saving goals">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1.5, sm: 3 }} alignItems={{ sm: 'center' }}>
              <Box sx={{ minWidth: 150 }}>
                <Typography variant="h4" color={o.safeToSpend.amount > 0 ? 'success.main' : 'error.main'} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(o.safeToSpend.amount)}</Typography>
                <Typography variant="caption" color="text.secondary">{o.safeToSpend.amount > 0 ? `about ${money(o.safeToSpend.amount / o.safeToSpend.days)} a day` : 'nothing spare right now'}</Typography>
              </Box>
              <Stack spacing={0.4} sx={{ flex: 1, minWidth: 0 }}>
                <Row label="Money you have" value={o.balance.amount} />
                <Row label="Income expected" value={o.safeToSpend.incomeExpected} sign="+" />
                <Row label="Bills due" value={o.safeToSpend.billsDue} sign="−" />
                <Row label={`Everyday spending${o.safeToSpend.everydaySource === 'average' ? ' (your average)' : o.safeToSpend.everydaySource === 'none' ? ' (not set)' : ''}`} value={o.safeToSpend.everyday} sign="−" />
                {o.safeToSpend.savingsTarget > 0 && <Row label="Savings target" value={o.safeToSpend.savingsTarget} sign="−" />}
                {o.safeToSpend.goals > 0 && <Row label="Saving goals" value={o.safeToSpend.goals} sign="−" />}
              </Stack>
            </Stack>
            {o.safeToSpend.everydaySource === 'none' && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>Tip: set “Expected variable expenses” in <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer' }} onClick={() => nav('/budgets')}>Budgets</Box> so food, fuel and the like are counted.</Typography>}
          </SectionCard>
        </Grid>

        <Grid size={12}>
          <Stack spacing={1}>
            {o.notes.map((n, i) => <Alert key={i} severity={n.status === 'pass' ? 'success' : n.status === 'warn' ? 'warning' : 'error'}>{n.text}</Alert>)}
          </Stack>
        </Grid>

        {/* Should I buy it? */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Should I buy it?" subtitle="Type what it costs and I’ll check it against your balance, bills, income, savings and saving goals">
            <Stack component="form" onSubmit={check} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
              <TextField label="What is it? (optional)" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
              <Box sx={{ minWidth: { sm: 170 } }}><MoneyInput label="How much?" value={amount} onChange={(x) => { setAmount(x); setResult(null); }} /></Box>
              <Button type="submit" variant="contained" size="large" disabled={checking || !(Number(amount) > 0)} sx={{ whiteSpace: 'nowrap', minWidth: 120, height: 40 }}>{checking ? 'Checking…' : 'Check'}</Button>
            </Stack>

            {result && v && (
              <Box sx={{ mt: 2 }} aria-live="polite">
                <Box sx={{ p: 2, borderRadius: 2, border: 1, borderColor: `${v.color}.main`, bgcolor: alpha(theme.palette[v.color].main, theme.palette.mode === 'dark' ? 0.16 : 0.08) }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Box sx={{ color: `${v.color}.main`, display: 'flex', mt: 0.25, '& svg': { fontSize: 30 } }}>{v.icon}</Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" sx={{ lineHeight: 1.25 }}>{result.headline}</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>{result.name ? `${result.name} · ` : ''}{money(result.amount)}. {result.summary}</Typography>
                    </Box>
                  </Stack>
                </Box>

                {result.checks.length > 0 && (
                  <Stack spacing={1.25} sx={{ mt: 2 }}>
                    <Typography variant="subtitle2">Why</Typography>
                    {result.checks.map((c) => (
                      <Stack key={c.key} direction="row" spacing={1.25} alignItems="flex-start">
                        <Box sx={{ mt: 0.2, display: 'flex' }}>{statusIcon(c.status)}</Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600}>{c.title}</Typography>
                          <Typography variant="body2" color="text.secondary">{c.detail}</Typography>
                        </Box>
                      </Stack>
                    ))}
                  </Stack>
                )}

                {result.facts.length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                    {result.facts.map((f) => <Chip key={f.label} variant="outlined" label={<><Box component="span" sx={{ color: 'text.secondary' }}>{f.label}: </Box><b>{f.value}</b></>} />)}
                  </Stack>
                )}

                {result.suggestions.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>What would help</Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                      {result.suggestions.map((s, i) => <Typography key={i} component="li" variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>{s}</Typography>)}
                    </Box>
                  </Box>
                )}
                {result.verdict !== 'unknown' && <Button startIcon={<PlaylistAddIcon />} sx={{ mt: 1.5 }} onClick={addWish}>Add to wishlist</Button>}
              </Box>
            )}
          </SectionCard>
        </Grid>

        {/* Wishlist */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Wishlist" subtitle="Checked again every time you open this page">
            {wishlist.isLoading ? <LoadingBlock rows={2} /> : !wanted.length && !bought.length ? (
              <Typography variant="body2" color="text.secondary">Nothing here yet. Check a purchase and choose “Add to wishlist” — I’ll tell you when it becomes affordable.</Typography>
            ) : (
              <Stack divider={<Divider flexItem />} spacing={1.25}>
                {wanted.map((w) => {
                  const wv = VERDICT[w.verdict ?? 'unknown'];
                  return (
                    <Stack key={w.id} direction="row" spacing={1} alignItems="center">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{w.name} · {money(w.amount)}</Typography>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }} flexWrap="wrap" useFlexGap>
                          <Chip size="small" color={wv.color} label={wv.label} />
                          {w.verdict === 'wait' && w.affordableFrom && <Typography variant="caption" color="text.secondary">from {fmtShort(w.affordableFrom)}</Typography>}
                        </Stack>
                      </Box>
                      <Tooltip title="I bought it"><IconButton aria-label={`Mark ${w.name} as bought`} onClick={() => buyWish(w)}><ShoppingBagOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Remove"><IconButton aria-label={`Remove ${w.name}`} onClick={() => removeWish(w)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  );
                })}
                {bought.map((w) => (
                  <Typography key={w.id} variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>{w.name} · {money(w.amount)} — bought {fmtShort(w.boughtDate)}</Typography>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Grid>

        {/* Saving up for something by a date */}
        <Grid size={12}><SavingGoals /></Grid>

        {/* The week ahead */}
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="The next 7 days" subtitle="Money going out and coming in">
            <Stack spacing={0.75}>
              {!o.week.bills.length && !o.week.income.length && !o.week.jobs && <Typography variant="body2" color="text.secondary">Nothing booked or due in the next week.</Typography>}
              {o.week.bills.map((b, i) => <Row key={`b${i}`} label={`${b.name} · due ${fmtShort(b.dueDate)}`} value={b.amount} sign="−" />)}
              {o.week.income.map((inc, i) => <Row key={`i${i}`} label={`${inc.label} · expected ${fmtShort(inc.date)}`} value={inc.amount} sign="+" />)}
              {o.week.jobs > 0 && <Typography variant="body2" color="text.secondary">{o.week.jobs} job{o.week.jobs === 1 ? '' : 's'} booked{o.week.jobHours ? ` · ${o.week.jobHours} hours` : ''}{o.week.jobIncome ? ` · ${money(o.week.jobIncome)}` : ''}</Typography>}
            </Stack>
          </SectionCard>
        </Grid>

        {/* Work needed */}
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="How much more do I need to work?" subtitle="To cover this month’s bills, everyday costs and savings">
            {o.workNeeded.shortfall <= 0 ? (
              <Alert severity="success">You’re covered this month: {money(o.workNeeded.incomeIncludingExpected)} received or expected against {money(o.workNeeded.requiredIncome)} needed.</Alert>
            ) : (
              <>
                <Typography variant="h5" color="warning.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(o.workNeeded.shortfall)} to go</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {money(o.workNeeded.incomeIncludingExpected)} received or expected against {money(o.workNeeded.requiredIncome)} needed.
                  {o.workNeeded.hours ? ` That’s about ${o.workNeeded.hours} more hours of work at your usual ${money(o.workNeeded.avgPerHour)} an hour.` : ' Complete a few jobs with hours and pay and I can turn this into hours.'}
                </Typography>
              </>
            )}
          </SectionCard>
        </Grid>

        {/* Where the money goes */}
        <Grid size={12}>
          <SectionCard title="Where is my money going?" subtitle="This month so far against all of last month">
            {!o.topCategories.length ? <Typography variant="body2" color="text.secondary">No expenses recorded in the last two months.</Typography> : (
              <Stack spacing={0.75}>
                {o.topCategories.map((c, i) => (
                  <Stack key={i} direction="row" justifyContent="space-between" spacing={2}>
                    <Typography variant="body2" noWrap>{c.name}</Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><b>{money(c.thisMonth)}</b> <Box component="span" sx={{ color: 'text.secondary' }}>· last month {money(c.lastMonth)}</Box></Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
