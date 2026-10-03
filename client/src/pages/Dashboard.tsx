import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Grid, Box, Stack, Typography, Alert, Button, MenuItem, TextField, List, ListItem, ListItemText, Chip, Divider, Tooltip, IconButton, Snackbar } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SwipeAction from '../components/SwipeAction';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import { get, post, del } from '../api/client';
import { PageHeader, StatCard, SectionCard, DateRangeBar, rangeFor, LoadingBlock, ErrorBlock, ProgressRow, StatusChip, type DateRange } from '../components/common';
import { LineSeriesChart, BarSeriesChart, DonutChart, CashFlowChart } from '../components/charts';
import { money, fmtMonth, fmtShort, fmtTime, fmtDate, mapsUrl, localToday } from '../utils/format';
import { useLookupMaps } from '../hooks/useLookups';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useConfirm } from '../components/common';

/* eslint-disable @typescript-eslint/no-explicit-any */
type D = any;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const { categories, sources } = useLookupMaps();
  const [range, setRange] = useState<DateRange>(rangeFor('month'));
  const [sourceId, setSourceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const q = useQuery({ queryKey: ['dashboard', range.from, range.to, sourceId, categoryId], queryFn: () => get<D>('/dashboard', { from: range.from, to: range.to, incomeSourceId: sourceId, categoryId }) });
  const d: D = q.data;

  const completePast = async () => {
    if (!(await confirm({ title: `Mark ${d.work.pastUncompleted} past job(s) as completed?`, message: 'Jobs dated before today that are still "scheduled" will be marked completed. Their linked income stays as expected until you mark it paid.', confirmText: 'Mark completed' }))) return;
    const r = await post<{ updated: number }>('/jobs/complete-past');
    toast(`${r.updated} job(s) marked completed`);
    invalidate();
  };

  // Marking a bill paid from the dashboard records the expense straight away, with a few seconds to undo
  const [justPaid, setJustPaid] = useState<{ name: string; expenseId: string } | null>(null);
  const payBill = async (b: { billId: string; name: string; dueDate: string }) => {
    try {
      const now = localToday();
      const exp = await post<{ id: string }>(`/bills/${b.billId}/pay`, { occurrence: b.dueDate, date: now > b.dueDate ? b.dueDate : now });
      await invalidate();
      setJustPaid({ name: b.name, expenseId: exp.id });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const undoPay = async () => {
    if (!justPaid) return;
    const id = justPaid.expenseId;
    setJustPaid(null);
    try { await del(`/expenses/${id}`); await invalidate(); toast('Payment undone'); } catch (e) { toast((e as Error).message, 'error'); }
  };

  const today = d?.today;

  // "Need to earn" follows the period chosen at the top: the monthly requirement scaled to a day, week, year or custom range
  const need = (() => {
    const monthly = d?.required?.minimumMonthlyIncome ?? 0;
    const days = dayjs(range.to).diff(dayjs(range.from), 'day') + 1;
    const [label, required] = range.preset === 'today' ? ['day', (monthly * 12) / 365]
      : range.preset === 'week' ? ['week', (monthly * 12) / 52]
      : range.preset === 'year' ? ['year', monthly * 12]
      : range.preset === 'month' ? ['month', monthly]
      : [`${days} day${days === 1 ? '' : 's'}`, ((monthly * 12) / 365) * days];
    const coming = (d?.money?.incomeReceived ?? 0) + (d?.money?.incomeExpected ?? 0);
    const req = Math.round((required as number) * 100) / 100;
    return { label: label as string, required: req, shortfall: Math.max(0, Math.round((req - coming) * 100) / 100) };
  })();
  const schedule = today ? [
    ...today.jobs.map((j: any) => ({ key: 'j' + j.id, time: j.startTime, title: j.clientName ?? 'Job', sub: j.address?.formatted, chip: j.amount ? money(j.amount) : undefined, kind: 'Job', status: j.status, map: j.address?.formatted })),
    ...today.tasks.map((t: any) => ({ key: 't' + t.id, time: t.startTime, title: t.title, sub: t.location, kind: t.category, status: t.status })),
    ...today.billsDue.map((b: any) => ({ key: 'b' + b.billId, time: undefined, title: `${b.name} due`, chip: money(b.amount), kind: 'Bill', status: b.paid ? 'paid' : 'due' })),
    ...today.invoicesDue.map((i: any) => ({ key: 'i' + i.id, time: undefined, title: `Invoice ${i.number} due`, chip: money(i.total), kind: 'Invoice', status: i.effectiveStatus })),
  ].sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')) : [];

  return (
    <Box>
      <PageHeader
        title={`${greeting()}, ${user?.name?.split(' ')[0] ?? ''}`}
        subtitle={fmtDate(today?.date ?? undefined, 'dddd D MMMM YYYY')}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <DateRangeBar value={range} onChange={setRange} />
            <TextField select fullWidth={false} size="small" label="Income source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">All sources</MenuItem>
              {sources.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
            <TextField select fullWidth={false} size="small" label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          </Stack>
        }
      />
      {q.isLoading ? <LoadingBlock rows={6} height={90} /> : q.error ? <ErrorBlock error={q.error} onRetry={q.refetch} /> : (
        <Stack spacing={2.5}>
          {d.work.pastUncompleted > 0 && (
            <Alert severity="warning" action={<Button color="inherit" size="small" onClick={completePast}>Mark completed</Button>}>
              {d.work.pastUncompleted} past job(s) are still marked as scheduled.
            </Alert>
          )}

          {/* Money: how much came in, how much went out, what's left */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label="Income received" value={money(d.money.incomeReceived)} hint={`+ ${money(d.money.incomeExpected)} expected`} tone="positive" icon={<TrendingUpIcon />} onClick={() => nav('/income')} /></Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label="Expenses" value={money(d.money.expenses)} hint={`${money(d.money.avgDailySpending)} / day avg`} tone="negative" icon={<TrendingDownIcon />} onClick={() => nav('/expenses')} /></Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label="Net income" value={money(d.money.net)} hint={`Projected ${money(d.money.projectedNet)}`} tone={d.money.net >= 0 ? 'positive' : 'negative'} icon={<AccountBalanceWalletOutlinedIcon />} /></Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label="Left this month" value={money(d.month.remainingDisposable)} hint={`after ${money(d.month.unpaidBillsRemaining)} unpaid bills`} tone={d.month.remainingDisposable >= 0 ? 'neutral' : 'negative'} /></Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label={`Need to earn (${need.label})`} value={money(need.required)} hint={need.shortfall > 0 ? `${money(need.shortfall)} still needed` : 'Covered by received + expected'} tone={need.shortfall > 0 ? 'warning' : 'positive'} icon={<FlagOutlinedIcon />} onClick={() => nav('/budgets')} /></Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}><StatCard label="Outstanding invoices" value={money(d.invoices.outstandingAmount)} hint={`${d.invoices.outstandingCount} open · ${d.invoices.overdueCount} overdue`} tone={d.invoices.overdueCount ? 'negative' : 'neutral'} icon={<ReceiptLongOutlinedIcon />} onClick={() => nav('/invoices')} /></Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Today" subtitle={`${schedule.length} item(s)`} action={<Button size="small" onClick={() => nav('/my-day')}>Open My Day</Button>}>
                {!schedule.length ? <Typography variant="body2" color="text.secondary">Nothing scheduled today.</Typography> : (
                  <List dense disablePadding>
                    {schedule.map((s, i) => (
                      <Box key={s.key}>
                        {i > 0 && <Divider component="li" />}
                        <ListItem disableGutters secondaryAction={s.chip && <Chip size="small" label={s.chip} variant="outlined" />}>
                          <Box sx={{ width: 64, flexShrink: 0, color: 'text.secondary', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{s.time ? fmtTime(s.time) : 'All day'}</Box>
                          <ListItemText primary={s.title} secondary={s.map ? <a href={mapsUrl(s.map)} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s.sub}</a> : s.sub ?? s.kind} sx={{ pr: 8 }}
                            slotProps={{ primary: { variant: 'body2', fontWeight: 500, sx: { textDecoration: s.status === 'completed' ? 'line-through' : undefined } } }} />
                        </ListItem>
                      </Box>
                    ))}
                  </List>
                )}
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Upcoming bills" subtitle={`${money(d.bills.upcomingTotal)} in the next 30 days`} action={<Button size="small" onClick={() => nav('/bills')}>All bills</Button>}>
                {!d.bills.upcoming.length ? <Typography variant="body2" color="text.secondary">No unpaid bills in the next 30 days.</Typography> : (
                  <List dense disablePadding>
                    {d.bills.upcoming.slice(0, 7).map((b: any, i: number) => (
                      <Box key={b.billId + b.dueDate}>
                        {i > 0 && <Divider component="li" />}
                        <SwipeAction label="Paid" onAction={() => payBill(b)}>
                          <ListItem disableGutters sx={{ pr: 0 }}>
                            <ListItemText primary={b.name} secondary={`Due ${fmtShort(b.dueDate)}${b.autoPay ? ' · auto-pay' : ''}`} slotProps={{ primary: { variant: 'body2', fontWeight: 500 } }} />
                            <Typography variant="body2" fontWeight={600}>{money(b.amount)}</Typography>
                            <Tooltip title="Mark as paid"><IconButton size="small" aria-label={`Mark ${b.name} as paid`} onClick={() => payBill(b)} sx={{ ml: 0.5 }}><CheckCircleOutlineIcon fontSize="small" /></IconButton></Tooltip>
                          </ListItem>
                        </SwipeAction>
                      </Box>
                    ))}
                  </List>
                )}
                {d.bills.upcoming.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Swipe or drag a bill to the left to mark it as paid, or use the tick.</Typography>}
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 12, xl: 4 }}>
              <SectionCard title="How much do I need to earn?" subtitle="Minimum monthly income required">
                <Stack spacing={1}>
                  {[['Recurring bills (monthly equivalent)', d.required.monthlyBills], ['Expected variable expenses', d.required.expectedVariableExpenses], ['Target savings', d.required.savingsTarget]].map(([l, v]) => (
                    <Stack key={l as string} direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">{l}</Typography><Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(v as number)}</Typography></Stack>
                  ))}
                  <Divider />
                  <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle2">Minimum required</Typography><Typography variant="subtitle2">{money(d.required.minimumMonthlyIncome)}</Typography></Stack>
                  <Box sx={{ pt: 1 }}><ProgressRow label="Received + expected this month" value={d.month.incomeIncludingExpected} target={d.required.minimumMonthlyIncome} /></Box>
                  {d.budget.incomeTarget > 0 && <ProgressRow label="Monthly income target" value={d.month.incomeIncludingExpected} target={d.budget.incomeTarget} />}
                </Stack>
              </SectionCard>
            </Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 7 }}>
              <SectionCard title="Income vs expenses" subtitle="Last 12 months (received income)">
                <LineSeriesChart data={d.charts.monthly} xKey="month" xFormatter={fmtMonth} series={[{ key: 'income', name: 'Income' }, { key: 'expenses', name: 'Expenses' }, { key: 'net', name: 'Net', dashed: true }]} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, lg: 5 }}>
              <SectionCard title="Cash flow" subtitle="Running net for the selected period">
                <CashFlowChart data={d.charts.cashFlow} xFormatter={fmtShort} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <SectionCard title="Monthly income" subtitle="Received vs still expected">
                <BarSeriesChart data={d.charts.monthly} xKey="month" xFormatter={fmtMonth} stacked series={[{ key: 'income', name: 'Received' }, { key: 'expectedIncome', name: 'Expected' }]} height={240} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <SectionCard title="Monthly expenses">
                <BarSeriesChart data={d.charts.monthly} xKey="month" xFormatter={fmtMonth} series={[{ key: 'expenses', name: 'Expenses' }]} height={240} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <SectionCard title="Expenses by category" subtitle="Selected period"><DonutChart data={d.charts.expenseByCategory} /></SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <SectionCard title="Income by source" subtitle="Selected period (incl. expected)"><DonutChart data={d.charts.incomeBySource} /></SectionCard>
            </Grid>
          </Grid>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ pt: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>Work</Typography>
            {(d.work.byArrangement ?? []).map((a: any) => (
              <Chip key={a.workType} variant="outlined" color={a.workType === 'subcontract' ? 'secondary' : 'default'}
                label={`${a.workType === 'subcontract' ? 'Under contractors' : a.workType === 'employee' ? 'Employee shifts' : 'Own business'}: ${a.jobs} job${a.jobs === 1 ? '' : 's'} · ${money(a.income)}`} sx={{ display: a.workType === 'employee' && !a.jobs ? 'none' : undefined }} />
            ))}
          </Stack>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Jobs this week" value={d.work.jobsThisWeek} hint="completed" onClick={() => nav('/jobs')} /></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Jobs this month" value={d.work.jobsThisMonth} hint="completed" /></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Job income" value={money(d.work.jobIncome)} hint={`${d.work.jobsInRange} jobs in period`} /></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Hours worked" value={d.work.hoursWorked} hint="on completed jobs" /></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Avg per job" value={money(d.work.avgPerJob)} /></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><StatCard label="Avg per hour" value={d.work.avgPerHour ? money(d.work.avgPerHour) : '—'} /></Grid>
            {d.work.travel?.enabled && d.work.travel.days > 0 && (
              <>
                <Grid size={{ xs: 6, sm: 3 }}><StatCard label="Km driven" value={`${d.work.travel.km.toFixed(1)} km`} hint={`${d.work.travel.days} work day(s) · ${Math.round(d.work.travel.minutes / 60)} h driving`} /></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><StatCard label="Fuel cost (est.)" value={money(d.work.travel.fuelCost)} hint={`${d.work.travel.litres} litres`} tone="negative" /></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><StatCard label="Job income after fuel" value={money(d.work.travel.incomeAfterFuel)} tone="positive" /></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><StatCard label="Income per km" value={d.work.travel.perKm ? money(d.work.travel.perKm) : '—'} /></Grid>
              </>
            )}
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Upcoming jobs" subtitle="Next 7 days" action={<Button size="small" onClick={() => nav('/jobs')}>All jobs</Button>}>
                {!d.work.upcoming.length ? <Typography variant="body2" color="text.secondary">No upcoming jobs. Paste a schedule to add some.</Typography> : (
                  <List dense disablePadding>
                    {d.work.upcoming.map((j: any, i: number) => (
                      <Box key={j.id}>
                        {i > 0 && <Divider component="li" />}
                        <ListItem disableGutters secondaryAction={<Typography variant="body2" fontWeight={600}>{money(j.amount)}</Typography>}>
                          <ListItemText primary={`${j.clientName ?? 'Job'}`} secondary={`${fmtShort(j.date)} ${fmtTime(j.startTime)} · ${j.address?.suburb ?? ''}`} slotProps={{ primary: { variant: 'body2', fontWeight: 500 } }} />
                        </ListItem>
                      </Box>
                    ))}
                  </List>
                )}
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Income by client" subtitle="Selected period">
                <BarSeriesChart data={d.charts.incomeByClient.slice(0, 8)} xKey="name" horizontal series={[{ key: 'value', name: 'Income' }]} height={Math.max(160, Math.min(8, d.charts.incomeByClient.length) * 34)} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, xl: 4 }}>
              <SectionCard title="Income per job & per hour" subtitle="Monthly averages, completed jobs">
                <LineSeriesChart data={d.charts.workMonthly} xKey="month" xFormatter={fmtMonth} series={[{ key: 'perJob', name: 'Per job' }, { key: 'perHour', name: 'Per hour' }]} height={220} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <SectionCard title="Income per job" subtitle="Each completed job in the selected period">
                <BarSeriesChart data={d.work.perJob.map((j: any) => ({ ...j, label: `${fmtShort(j.date)} ${j.client ?? ''}` }))} xKey="label" series={[{ key: 'amount', name: 'Amount' }]} height={220} />
              </SectionCard>
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ pt: 1 }}>Spending & savings</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Weekly spending trend" subtitle="Last 12 weeks">
                <BarSeriesChart data={d.charts.weekly} xKey="week" xFormatter={fmtShort} series={[{ key: 'spending', name: 'Spending' }]} height={220} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Daily spending" subtitle="Selected period">
                <BarSeriesChart data={d.charts.cashFlow} xKey="date" xFormatter={fmtShort} series={[{ key: 'expenses', name: 'Spent' }]} height={220} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <SectionCard title="Monthly bills breakdown" subtitle={`${money(d.required.monthlyBills)} / month equivalent`}>
                <BarSeriesChart data={d.charts.billsBreakdown.slice(0, 8)} xKey="name" horizontal series={[{ key: 'monthly', name: 'Per month' }]} height={Math.max(160, Math.min(8, d.charts.billsBreakdown.length) * 34)} />
              </SectionCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 12 }}>
              <SectionCard title="Savings & budget progress" action={<Button size="small" startIcon={<SavingsOutlinedIcon />} onClick={() => nav('/budgets')}>Budgets</Button>}>
                <Grid container spacing={2.5}>
                  <Grid size={{ xs: 12, xl: 4 }}><ProgressRow label="Net this month vs savings target" value={Math.max(0, d.month.savingsThisMonth)} target={d.savings.monthlyTarget} /></Grid>
                  <Grid size={{ xs: 12, xl: 4 }}><ProgressRow label="Emergency fund" value={d.savings.emergencyFund} target={d.savings.emergencyFundTarget} /></Grid>
                  <Grid size={{ xs: 12, xl: 4 }}><ProgressRow label="Monthly spending limit" value={d.month.expenses} target={d.budget.spendingLimit} invert /></Grid>
                  {d.budget.categoryBudgets.map((c: any) => <Grid key={c.categoryId} size={{ xs: 12, sm: 6, xl: 3 }}><ProgressRow label={c.name} value={c.spent} target={c.budget} invert /></Grid>)}
                </Grid>
                <Stack direction="row" spacing={3} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                  <Tooltip title="Average received income per month over past months with data"><Typography variant="body2" color="text.secondary">Avg monthly income: <b>{money(d.money.avgMonthlyIncome)}</b></Typography></Tooltip>
                  <Typography variant="body2" color="text.secondary">Avg weekly income: <b>{money(d.money.avgWeeklyIncome)}</b></Typography>
                  <Typography variant="body2" color="text.secondary">Avg monthly expenses: <b>{money(d.money.avgMonthlyExpenses)}</b></Typography>
                  <Typography variant="body2" color="text.secondary">Savings balance: <b>{money(d.savings.current)}</b></Typography>
                  <Typography variant="body2" color="text.secondary">Paid invoices: <b>{d.invoices.paidCount}</b> ({money(d.invoices.paidAmount)}) · Unpaid: <b>{d.invoices.unpaidCount}</b></Typography>
                </Stack>
              </SectionCard>
            </Grid>
          </Grid>
          {d.invoices.dueSoon.length > 0 && (
            <SectionCard title="Invoices due soon">
              <Stack spacing={1}>{d.invoices.dueSoon.map((i: any) => (
                <Stack key={i.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => nav(`/invoices/${i.id}`)}>
                  <Typography variant="body2" sx={{ flex: 1 }}>{i.number} · {i.clientName}</Typography>
                  <Typography variant="body2" color="text.secondary">{i.dueDate ? `Due ${fmtShort(i.dueDate)}` : 'No due date'}</Typography>
                  <StatusChip status={i.effectiveStatus} />
                  <Typography variant="body2" fontWeight={600}>{money(i.total)}</Typography>
                </Stack>
              ))}</Stack>
            </SectionCard>
          )}
        </Stack>
      )}
      <Snackbar open={!!justPaid} autoHideDuration={6000} onClose={(_, reason) => { if (reason !== 'clickaway') setJustPaid(null); }} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ bottom: { xs: 'calc(76px + env(safe-area-inset-bottom))', sm: 24 } }}>
        <Alert severity="success" variant="filled" action={<Button color="inherit" size="small" onClick={undoPay}>Undo</Button>} sx={{ width: '100%' }}>{justPaid?.name} marked as paid</Alert>
      </Snackbar>
    </Box>
  );
}
