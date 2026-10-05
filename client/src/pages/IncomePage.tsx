import { useRef, useState } from 'react';
import { Typography, Grid, Chip } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MarkIncomePaidDialog from '../components/MarkIncomePaidDialog';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RepeatIcon from '@mui/icons-material/Repeat';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import { ResourcePage, type ResourceConfig } from '../components/ResourcePage';
import { StatusChip, StatCard } from '../components/common';
import type { Income } from '../api/types';
import { incomeFields, incomeDefaults } from '../utils/forms';
import { money, fmtDate, localToday } from '../utils/format';
import { patch, post } from '../api/client';
import { useConfirm } from '../components/common';
import { useLookupMaps } from '../hooks/useLookups';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';

export default function IncomePage() {
  const { sources, srcById } = useLookupMaps();
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const confirm = useConfirm();
  // "Mark paid" for several records opens a dialog; the selection is cleared only if it was saved
  const [paying, setPaying] = useState<Income[] | null>(null);
  const payDone = useRef<((saved: boolean) => void) | null>(null);
  const markPaid = (rows: Income[]) => new Promise<boolean>((resolve) => { payDone.current = resolve; setPaying(rows); });
  const closePay = (saved: boolean) => { setPaying(null); if (saved) invalidate(); payDone.current?.(saved); payDone.current = null; };
  const removeMany = async (rows: Income[]) => {
    const linked = rows.filter((r) => r.jobId).length, paid = rows.filter((r) => r.status === 'paid').length;
    const ok = await confirm({
      title: `Delete ${rows.length} income record${rows.length === 1 ? '' : 's'}?`,
      message: `${money(rows.reduce((a, r) => a + r.amount, 0))} in total${paid ? `, including ${paid} already marked as paid` : ''}. ${linked ? `${linked} ${linked === 1 ? 'is' : 'are'} linked to a job — the job${linked === 1 ? ' is' : 's are'} kept. ` : ''}This cannot be undone; the deletions are recorded in the audit log.`,
      confirmText: `Delete ${rows.length}`, danger: true,
    });
    if (!ok) return false;
    const r = await post<{ deleted: number }>('/income/bulk-delete', { ids: rows.map((x) => x.id) });
    await invalidate();
    toast(`${r.deleted} record${r.deleted === 1 ? '' : 's'} deleted`);
  };
  const config: ResourceConfig<Income> = {
    queryKey: 'income', endpoint: '/income', title: 'Income', singular: 'Income record',
    fields: incomeFields, defaults: incomeDefaults, dateFilter: true,
    fromRecord: (i) => ({ ...i, recurring: i.recurring ?? { enabled: false } }),
    filters: [
      { name: 'status', label: 'Status', options: ['expected', 'pending', 'paid', 'cancelled'].map((s) => ({ value: s, label: s })) },
      { name: 'incomeSourceId', label: 'Source', options: sources.map((s) => ({ value: s.id, label: s.name })) },
    ],
    columns: [
      { key: 'date', label: 'Date', render: (i) => fmtDate(i.date, 'ddd D MMM YYYY') },
      { key: 'source', label: 'Source', render: (i) => { const s = i.incomeSourceId ? srcById.get(i.incomeSourceId) : undefined; return s ? <Chip size="small" label={s.name} sx={{ bgcolor: s.color + '22', color: 'text.primary' }} /> : '—'; } },
      { key: 'clientName', label: 'Client / description', render: (i) => <><Typography variant="body2" fontWeight={500}>{i.clientName ?? i.description ?? '—'}</Typography>{i.clientName && i.description && <Typography variant="caption" color="text.secondary">{i.description}</Typography>}</> },
      { key: 'invoiceNumber', label: 'Invoice', render: (i) => i.invoiceNumber ?? '—' },
      { key: 'amount', label: 'Amount', align: 'right', render: (i) => <Typography variant="body2" fontWeight={600}>{money(i.amount)}</Typography>, sortValue: (i) => i.amount },
      { key: 'status', label: 'Status', render: (i) => <><StatusChip status={i.status} />{(i.recurring?.enabled && !i.recurringParentId) && <Chip size="small" icon={<RepeatIcon />} label={`Repeats ${i.recurring.frequency ?? ''}`} variant="outlined" sx={{ ml: 0.5 }} />}{i.recurringParentId && <Chip size="small" icon={<RepeatIcon />} label="Auto" variant="outlined" sx={{ ml: 0.5 }} />}</> },
    ],
    mobileTitle: (i) => i.clientName ?? i.description ?? 'Income',
    mobileSubtitle: (i) => `${fmtDate(i.date)} · ${i.incomeSourceId ? srcById.get(i.incomeSourceId)?.name ?? '' : ''}`,
    mobileRight: (i) => <><Typography variant="body2" fontWeight={600}>{money(i.amount)}</Typography><StatusChip status={i.status} /></>,
    rowActions: [
      { label: 'Stop repeating', icon: <EventBusyOutlinedIcon fontSize="small" />, show: (i) => !!i.recurringParentId || !!i.recurring?.enabled,
        onClick: async (i) => {
          if (!(await confirm({ title: 'Stop this repeating income?', message: 'No new entries will be created, and future entries that are still “expected” are removed. Past and paid entries are kept.', confirmText: 'Stop repeating' }))) return;
          try { const r = await post<{ removed: number }>(`/income/${i.id}/stop-recurring`, { removeFuture: true }); invalidate(); toast(`Stopped repeating${r.removed ? ` · ${r.removed} future entr${r.removed === 1 ? 'y' : 'ies'} removed` : ''}`); } catch (e) { toast((e as Error).message, 'error'); }
        } },
      { label: 'Mark paid today', icon: <CheckCircleOutlineIcon fontSize="small" />, show: (i) => i.status !== 'paid' && i.status !== 'cancelled', onClick: async (i) => { await patch(`/income/${i.id}`, { status: 'paid', paidDate: localToday() }); invalidate(); toast('Marked as paid'); } },
    ],
    bulkActions: [
      { label: 'Mark paid', icon: <CheckCircleOutlineIcon fontSize="small" />, onClick: markPaid, variant: 'contained' },
      { label: 'Delete', icon: <DeleteOutlineIcon fontSize="small" />, onClick: removeMany, color: 'error' },
    ],
    deleteMessage: (i) => (i.jobId ? 'This income is linked to a job. Deleting it does not delete the job.' : 'This cannot be undone. The deletion is recorded in the audit log.'),
    summary: (items) => {
      const live = items.filter((i) => i.status !== 'cancelled');
      const paid = live.filter((i) => i.status === 'paid').reduce((a, i) => a + i.amount, 0);
      const exp = live.filter((i) => i.status !== 'paid').reduce((a, i) => a + i.amount, 0);
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 4 }}><StatCard label="Received" value={money(paid)} tone="positive" /></Grid>
          <Grid size={{ xs: 6, md: 4 }}><StatCard label="Expected / pending" value={money(exp)} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><StatCard label="Total" value={money(paid + exp)} hint={`${live.length} records`} /></Grid>
        </Grid>
      );
    },
  };
  return <><ResourcePage config={config} /><MarkIncomePaidDialog rows={paying} onClose={closePay} /></>;
}
