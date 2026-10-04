import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Grid, TextField, Button, Stack, Typography, InputAdornment, MenuItem, IconButton, Alert, Divider } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import { get, put } from '../api/client';
import type { Budget } from '../api/types';
import { PageHeader, SectionCard, ProgressRow, LoadingBlock, StatCard, WeekChange } from '../components/common';
import { BarSeriesChart } from '../components/charts';
import { money, localToday, startOfMonth, endOfMonth, fmtShort } from '../utils/format';
import { useCategories } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MoneyField = ({ label, value, onChange, helper }: { label: string; value: number | string; onChange: (v: string) => void; helper?: string }) => (
  <TextField label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} helperText={helper}
    slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01' } }} />
);

// Targets are typed in per week; they are stored per month (everything else in the app works from the monthly figure)
const WEEKLY = ['monthlyIncomeTarget', 'monthlySpendingLimit', 'expectedVariableExpenses', 'monthlySavingsTarget'] as const;
const r2 = (x: number) => Math.round(x * 100) / 100;
const toWeekly = (monthly: number) => r2(((Number(monthly) || 0) * 12) / 52);
const toMonthly = (weekly: number) => r2(((Number(weekly) || 0) * 52) / 12);
const asWeekly = (b: Budget): Budget => ({ ...b, ...Object.fromEntries(WEEKLY.map((k) => [k, toWeekly(b[k])])) });

export default function Budgets() {
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const cats = useCategories();
  const today = localToday();
  const budget = useQuery({ queryKey: ['budget'], queryFn: () => get<Budget>('/budget') });
  const dash = useQuery({ queryKey: ['dashboard', 'budget-page'], queryFn: () => get<any>('/dashboard', { from: startOfMonth(today), to: endOfMonth(today) }) });
  const [form, setForm] = useState<Budget | null>(null);
  const [saving, setSaving] = useState(false);
  // The monthly figures as stored, so a weekly amount that wasn't touched goes back exactly as it was
  const [stored, setStored] = useState<Budget | null>(null);
  useEffect(() => { if (budget.data && !form) { setForm(asWeekly(budget.data)); setStored(budget.data); } }, [budget.data, form]);
  if (!form || dash.isLoading) return <LoadingBlock rows={6} height={70} />;
  const d = dash.data;
  const set = (k: keyof Budget, v: any) => setForm({ ...form, [k]: v });
  const n = (v: any) => Number(v) || 0;
  // form.* targets are weekly amounts here
  const billsWeekly = toWeekly(d?.required.monthlyBills ?? 0);
  const required = r2(billsWeekly + n(form.expectedVariableExpenses) + n(form.monthlySavingsTarget));
  const w = d?.week;
  const monthlyOf = (k: (typeof WEEKLY)[number]) => (stored && n(form[k]) === toWeekly(stored[k]) ? stored[k] : toMonthly(n(form[k])));
  const spentByCat = new Map<string, number>((d?.charts.expenseByCategory ?? []).map((c: any) => [c.id, c.value]));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, categoryBudgets: form.categoryBudgets.filter((c) => c.categoryId).map((c) => ({ categoryId: c.categoryId, amount: n(c.amount) })) };
      for (const k of ['monthlyIncomeTarget', 'monthlySpendingLimit', 'expectedVariableExpenses', 'monthlySavingsTarget', 'emergencyFundTarget', 'currentSavings', 'currentEmergencyFund'] as const) (body as any)[k] = (WEEKLY as readonly string[]).includes(k) ? monthlyOf(k as (typeof WEEKLY)[number]) : n(form[k]);
      const saved = await put<Budget>('/budget', body);
      // keep exactly what was typed rather than the round trip through the monthly figure
      setForm({ ...asWeekly(saved), ...Object.fromEntries(WEEKLY.map((k) => [k, n(form[k])])) });
      setStored(saved);
      invalidate();
      toast('Budget saved');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  };

  return (
    <Box>
      <PageHeader title="Budgets" subtitle="Set weekly targets once; progress and warnings update automatically." actions={<Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save budget'}</Button>} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Minimum income required (week)" value={money(required)} hint={`Bills ${money(billsWeekly)} + variable expenses + savings · ${money(toMonthly(required))} a month`} tone="warning" /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><StatCard label="Income this week" value={money(w?.incomeIncludingExpected)} hint={w ? <><span>{money(w.incomeReceived)} received</span><br /><WeekChange change={w.changeFromPrevious} previous={w.previous.income} /></> : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><StatCard label="Spent this week" value={money(w?.expenses)} tone="negative" hint={w ? `${fmtShort(w.from)} – ${fmtShort(w.to)}` : undefined} /></Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Weekly targets" subtitle="Type what you want per week. Monthly figures elsewhere in the app are worked out from these.">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Weekly income target" value={form.monthlyIncomeTarget} onChange={(v) => set('monthlyIncomeTarget', v)} helper={`${money(monthlyOf('monthlyIncomeTarget'))} a month`} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Weekly spending limit" value={form.monthlySpendingLimit} onChange={(v) => set('monthlySpendingLimit', v)} helper={`${money(monthlyOf('monthlySpendingLimit'))} a month`} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Expected variable expenses (per week)" value={form.expectedVariableExpenses} onChange={(v) => set('expectedVariableExpenses', v)} helper="Food, fuel, etc. (not recurring bills)" /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Weekly savings target" value={form.monthlySavingsTarget} onChange={(v) => set('monthlySavingsTarget', v)} helper={`${money(monthlyOf('monthlySavingsTarget'))} a month`} /></Grid>
              <Grid size={12}><Divider /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Current savings balance" value={form.currentSavings} onChange={(v) => set('currentSavings', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Emergency fund target" value={form.emergencyFundTarget} onChange={(v) => set('emergencyFundTarget', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Emergency fund balance" value={form.currentEmergencyFund} onChange={(v) => set('currentEmergencyFund', v)} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Progress this week" subtitle={w ? `${fmtShort(w.from)} – ${fmtShort(w.to)}` : undefined}>
            <Stack spacing={2.25}>
              {w && <Box><Typography variant="body2" color="text.secondary">Earned this week (received + expected)</Typography><Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(w.incomeIncludingExpected)}</Typography><WeekChange change={w.changeFromPrevious} previous={w.previous.income} /></Box>}
              <ProgressRow label="Weekly income (incl. expected)" value={w?.incomeIncludingExpected ?? 0} target={n(form.monthlyIncomeTarget)} />
              <ProgressRow label="Minimum required income" value={w?.incomeIncludingExpected ?? 0} target={required} />
              <ProgressRow label="Spending vs limit" value={w?.expenses ?? 0} target={n(form.monthlySpendingLimit)} invert />
              <ProgressRow label="Net this week vs savings target" value={Math.max(0, (w?.incomeReceived ?? 0) - (w?.expenses ?? 0))} target={n(form.monthlySavingsTarget)} />
              <ProgressRow label="Emergency fund" value={n(form.currentEmergencyFund)} target={n(form.emergencyFundTarget)} />
              {(w?.incomeIncludingExpected ?? 0) < required && <Alert severity="warning">This week’s income ({money(w?.incomeIncludingExpected)}) is below what you need ({money(required)}) — {money(required - (w?.incomeIncludingExpected ?? 0))} to go.</Alert>}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Category budgets" subtitle="Monthly limit per expense category" action={<Button size="small" startIcon={<AddIcon />} onClick={() => set('categoryBudgets', [...form.categoryBudgets, { categoryId: '', amount: 0 }])}>Add</Button>}>
            <Stack spacing={2}>
              {!form.categoryBudgets.length && <Typography variant="body2" color="text.secondary">No category budgets yet. Add one to get warnings when spending goes over.</Typography>}
              {form.categoryBudgets.map((cb, i) => (
                <Box key={i}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <TextField select label="Category" value={cb.categoryId} onChange={(e) => set('categoryBudgets', form.categoryBudgets.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}>
                      {(cats.data ?? []).map((c) => <MenuItem key={c.id} value={c.id} disabled={form.categoryBudgets.some((x, j) => j !== i && x.categoryId === c.id)}>{c.name}</MenuItem>)}
                    </TextField>
                    <Box sx={{ width: 160, flexShrink: 0 }}><MoneyField label="Limit" value={cb.amount} onChange={(v) => set('categoryBudgets', form.categoryBudgets.map((x, j) => (j === i ? { ...x, amount: v as any } : x)))} /></Box>
                    <IconButton aria-label="Remove" onClick={() => set('categoryBudgets', form.categoryBudgets.filter((_, j) => j !== i))}><DeleteOutlineIcon /></IconButton>
                  </Stack>
                  {cb.categoryId && <ProgressRow label="Spent this month" value={spentByCat.get(cb.categoryId) ?? 0} target={n(cb.amount)} invert />}
                </Box>
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Spending by category this month">
            <BarSeriesChart data={(d?.charts.expenseByCategory ?? []).slice(0, 10)} xKey="name" horizontal series={[{ key: 'value', name: 'Spent' }]} colorByRow={(r) => r.color} height={Math.max(180, Math.min(10, d?.charts.expenseByCategory.length ?? 0) * 32)} />
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
