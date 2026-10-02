import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid, Typography, Stack, Button, Chip, List, ListItem, ListItemText, Divider, IconButton, Tooltip, ToggleButtonGroup, ToggleButton, Card } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { ResourcePage, type ResourceConfig } from '../components/ResourcePage';
import { StatCard, SectionCard, StatusChip, LoadingBlock } from '../components/common';
import { EntityFormDialog } from '../components/EntityForm';
import type { Bill, BillDue } from '../api/types';
import { billFields, billDefaults } from '../utils/forms';
import { money, fmtDate, titleCase, localToday, startOfMonth, endOfMonth, startOfWeek, addDays } from '../utils/format';
import { get, post } from '../api/client';
import { useLookupMaps } from '../hooks/useLookups';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import dayjs from 'dayjs';

interface Summary { monthlyBills: number; expectedVariableExpenses: number; savingsTarget: number; minimumMonthlyIncome: number; billsBreakdown: { id: string; monthly: number }[] }

export default function Bills() {
  const { catById } = useLookupMaps();
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  type Per = 'week' | 'fortnight' | 'month' | 'year';
  const [per, setPerState] = useState<Per>(() => { try { return (localStorage.getItem('pt-bills-per') as Per) || 'month'; } catch { return 'month'; } });
  const setPer = (p: Per) => { setPerState(p); try { localStorage.setItem('pt-bills-per', p); } catch { /* ignore */ } };
  const fromMonthly = (m?: number) => (m === undefined ? undefined : per === 'week' ? (m * 12) / 52 : per === 'fortnight' ? (m * 12) / 26 : per === 'year' ? m * 12 : m);
  const [view, setView] = useState<'week' | 'month'>('month');
  const [anchor, setAnchor] = useState(localToday());
  const rangeFrom = view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const rangeTo = view === 'week' ? addDays(startOfWeek(anchor), 6) : endOfMonth(anchor);
  const shift = (dir: 1 | -1) => setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : dayjs(anchor).add(dir, 'month').format('YYYY-MM-DD'));
  const [paying, setPaying] = useState<BillDue | null>(null);
  const due = useQuery({ queryKey: ['bills-due', rangeFrom, rangeTo], queryFn: () => get<{ items: BillDue[] }>('/bills/due', { from: rangeFrom, to: rangeTo }) });
  const summary = useQuery({ queryKey: ['bills-summary'], queryFn: () => get<Summary>('/bills/summary') });
  const monthly = new Map((summary.data?.billsBreakdown ?? []).map((b) => [b.id, b.monthly]));
  const items = due.data?.items ?? [];
  const unpaid = items.filter((b) => !b.paid);

  const perLabel = { week: 'Weekly', fortnight: 'Fortnightly', month: 'Monthly', year: 'Yearly' }[per];
  const panel = (
    <>
    <Card sx={{ mb: 2, p: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <Typography variant="body2" color="text.secondary">Show bill totals per</Typography>
        <ToggleButtonGroup exclusive size="small" value={per} onChange={(_, v: Per | null) => v && setPer(v)}>
          <ToggleButton value="week">Week</ToggleButton><ToggleButton value="fortnight">Fortnight</ToggleButton><ToggleButton value="month">Month</ToggleButton><ToggleButton value="year">Year</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Card>
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Stack spacing={2} sx={{ height: '100%' }}>
          <StatCard label={`${perLabel} bills (equivalent)`} value={money(fromMonthly(summary.data?.monthlyBills))} hint={`All bills converted to a ${per} amount (e.g. monthly × 12 ÷ 52 for a week)`} />
          <StatCard label={`Minimum income required per ${per}`} value={money(fromMonthly(summary.data?.minimumMonthlyIncome))} hint={`Bills ${money(fromMonthly(summary.data?.monthlyBills))} + variable ${money(fromMonthly(summary.data?.expectedVariableExpenses))} + savings ${money(fromMonthly(summary.data?.savingsTarget))}`} tone="warning" />
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>
        <SectionCard
          title={view === 'week' ? `Due ${fmtDate(rangeFrom, 'D MMM')} – ${fmtDate(rangeTo, 'D MMM YYYY')}` : `Due in ${dayjs(anchor).format('MMMM YYYY')}`}
          subtitle={`${money(unpaid.reduce((a, b) => a + b.amount, 0))} unpaid of ${money(items.reduce((a, b) => a + b.amount, 0))}`}
          action={<Stack direction="row" alignItems="center" spacing={0.5}>
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)}><ToggleButton value="week" sx={{ py: 0.25 }}>Week</ToggleButton><ToggleButton value="month" sx={{ py: 0.25 }}>Month</ToggleButton></ToggleButtonGroup>
            <IconButton size="small" aria-label={`Previous ${view}`} onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
            <IconButton size="small" aria-label={`Next ${view}`} onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
          </Stack>}
        >
          {due.isLoading ? <LoadingBlock rows={3} /> : !items.length ? <Typography variant="body2" color="text.secondary">No bills due this {view}.</Typography> : (
            <List dense disablePadding sx={{ maxHeight: 300, overflow: 'auto' }}>
              {items.map((b, i) => (
                <div key={b.billId + b.dueDate}>
                  {i > 0 && <Divider component="li" />}
                  <ListItem disableGutters secondaryAction={b.paid ? <StatusChip status="paid" /> : <Button size="small" variant="outlined" onClick={() => setPaying(b)}>Mark paid</Button>}>
                    <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center"><span>{b.name}</span>{b.autoPay && <Chip size="small" label="Auto-pay" variant="outlined" />}</Stack>}
                      secondary={`${fmtDate(b.dueDate, 'ddd D MMM')} · ${money(b.amount)}`} sx={{ pr: 14 }} slotProps={{ primary: { variant: 'body2', fontWeight: 500, component: 'div' } }} />
                  </ListItem>
                </div>
              ))}
            </List>
          )}
        </SectionCard>
      </Grid>
    </Grid>
    </>
  );

  const config: ResourceConfig<Bill> = {
    queryKey: 'bills', endpoint: '/bills', title: 'Recurring bills', singular: 'Bill',
    subtitle: 'Mark a bill paid to record it as an expense (once per due date).',
    fields: billFields, defaults: billDefaults, beforeList: panel,
    filters: [{ name: 'frequency', label: 'Frequency', options: ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'custom'].map((f) => ({ value: f, label: titleCase(f) })) }],
    columns: [
      { key: 'name', label: 'Name', render: (b) => <><Typography variant="body2" fontWeight={500}>{b.name}</Typography>{b.categoryId && <Typography variant="caption" color="text.secondary">{catById.get(b.categoryId)?.name}</Typography>}</> },
      { key: 'frequency', label: 'Frequency', render: (b) => (b.frequency === 'custom' ? `Every ${b.customIntervalDays} days` : titleCase(b.frequency)) },
      { key: 'amount', label: 'Amount', align: 'right', render: (b) => money(b.amount), sortValue: (b) => b.amount },
      { key: 'monthly', label: `Per ${per}`, align: 'right', render: (b) => <Tooltip title={`${perLabel} equivalent`}><span>{money(fromMonthly(monthly.get(b.id)))}</span></Tooltip>, sortValue: (b) => monthly.get(b.id) ?? 0 },
      { key: 'dueDate', label: 'From', render: (b) => fmtDate(b.dueDate) },
      { key: 'paymentMethod', label: 'Payment', render: (b) => b.paymentMethod ?? '—' },
      { key: 'active', label: 'Status', render: (b) => <StatusChip status={b.active === false ? 'cancelled' : 'active'} /> },
    ],
    mobileTitle: (b) => b.name,
    mobileSubtitle: (b) => `${titleCase(b.frequency)} · ${money(fromMonthly(monthly.get(b.id)))}/${per}`,
    mobileRight: (b) => <Typography variant="body2" fontWeight={600}>{money(b.amount)}</Typography>,
    deleteMessage: () => 'Past payments recorded as expenses are kept.',
  };

  return (
    <>
      <ResourcePage config={config} />
      <EntityFormDialog
        open={!!paying}
        title={`Record payment – ${paying?.name ?? ''}`}
        submitLabel="Record payment"
        fields={[
          { name: 'amount', label: 'Amount paid', type: 'money', required: true },
          { name: 'date', label: 'Date paid', type: 'date', required: true },
          { name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        initial={{ amount: paying?.amount, date: localToday() > (paying?.dueDate ?? '') ? paying?.dueDate : localToday(), paymentMethod: paying?.paymentMethod ?? '' }}
        onClose={() => setPaying(null)}
        onSubmit={async (v) => {
          await post(`/bills/${paying!.billId}/pay`, { ...v, occurrence: paying!.dueDate });
          invalidate();
          toast('Payment recorded as an expense');
        }}
      />
    </>
  );
}
