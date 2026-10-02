import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Grid, TextField, Button, Stack, Typography, InputAdornment, MenuItem, IconButton, Alert, Divider } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import { get, put } from '../api/client';
import type { Budget } from '../api/types';
import { PageHeader, SectionCard, ProgressRow, LoadingBlock, StatCard } from '../components/common';
import { BarSeriesChart } from '../components/charts';
import { money, localToday, startOfMonth, endOfMonth } from '../utils/format';
import { useCategories } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MoneyField = ({ label, value, onChange, helper }: { label: string; value: number | string; onChange: (v: string) => void; helper?: string }) => (
  <TextField label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} helperText={helper}
    slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01' } }} />
);

export default function Budgets() {
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const cats = useCategories();
  const today = localToday();
  const budget = useQuery({ queryKey: ['budget'], queryFn: () => get<Budget>('/budget') });
  const dash = useQuery({ queryKey: ['dashboard', 'budget-page'], queryFn: () => get<any>('/dashboard', { from: startOfMonth(today), to: endOfMonth(today) }) });
  const [form, setForm] = useState<Budget | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (budget.data && !form) setForm(budget.data); }, [budget.data, form]);
  if (!form || dash.isLoading) return <LoadingBlock rows={6} height={70} />;
  const d = dash.data;
  const set = (k: keyof Budget, v: any) => setForm({ ...form, [k]: v });
  const n = (v: any) => Number(v) || 0;
  const required = (d?.required.monthlyBills ?? 0) + n(form.expectedVariableExpenses) + n(form.monthlySavingsTarget);
  const spentByCat = new Map<string, number>((d?.charts.expenseByCategory ?? []).map((c: any) => [c.id, c.value]));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, categoryBudgets: form.categoryBudgets.filter((c) => c.categoryId).map((c) => ({ categoryId: c.categoryId, amount: n(c.amount) })) };
      for (const k of ['monthlyIncomeTarget', 'monthlySpendingLimit', 'expectedVariableExpenses', 'monthlySavingsTarget', 'emergencyFundTarget', 'currentSavings', 'currentEmergencyFund'] as const) (body as any)[k] = n(form[k]);
      const saved = await put<Budget>('/budget', body);
      setForm(saved);
      invalidate();
      toast('Budget saved');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  };

  return (
    <Box>
      <PageHeader title="Budgets" subtitle="Set targets once; progress and warnings update automatically." actions={<Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save budget'}</Button>} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Minimum income required" value={money(required)} hint="Bills + variable expenses + savings" tone="warning" /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><StatCard label="Income this month" value={money(d?.month.incomeIncludingExpected)} hint={`${money(d?.month.incomeReceived)} received`} /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><StatCard label="Spent this month" value={money(d?.month.expenses)} tone="negative" /></Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Monthly targets">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Monthly income target" value={form.monthlyIncomeTarget} onChange={(v) => set('monthlyIncomeTarget', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Monthly spending limit" value={form.monthlySpendingLimit} onChange={(v) => set('monthlySpendingLimit', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Expected variable expenses" value={form.expectedVariableExpenses} onChange={(v) => set('expectedVariableExpenses', v)} helper="Food, fuel, etc. (not recurring bills)" /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Monthly savings target" value={form.monthlySavingsTarget} onChange={(v) => set('monthlySavingsTarget', v)} /></Grid>
              <Grid size={12}><Divider /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Current savings balance" value={form.currentSavings} onChange={(v) => set('currentSavings', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Emergency fund target" value={form.emergencyFundTarget} onChange={(v) => set('emergencyFundTarget', v)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><MoneyField label="Emergency fund balance" value={form.currentEmergencyFund} onChange={(v) => set('currentEmergencyFund', v)} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Progress this month">
            <Stack spacing={2.25}>
              <ProgressRow label="Monthly income (incl. expected)" value={d?.month.incomeIncludingExpected ?? 0} target={n(form.monthlyIncomeTarget)} />
              <ProgressRow label="Minimum required income" value={d?.month.incomeIncludingExpected ?? 0} target={required} />
              <ProgressRow label="Spending vs limit" value={d?.month.expenses ?? 0} target={n(form.monthlySpendingLimit)} invert />
              <ProgressRow label="Net this month vs savings target" value={Math.max(0, d?.month.savingsThisMonth ?? 0)} target={n(form.monthlySavingsTarget)} />
              <ProgressRow label="Emergency fund" value={n(form.currentEmergencyFund)} target={n(form.emergencyFundTarget)} />
              {n(form.monthlyIncomeTarget) > 0 && (d?.month.incomeIncludingExpected ?? 0) < required && <Alert severity="warning">Expected income ({money(d?.month.incomeIncludingExpected)}) is below required income ({money(required)}).</Alert>}
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
