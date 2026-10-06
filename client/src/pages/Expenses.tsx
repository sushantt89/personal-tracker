import { Typography, Grid, Chip, Box } from '@mui/material';
import ReceiptOutlinedIcon from '@mui/icons-material/ReceiptOutlined';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import { Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '../components/ResourcePage';
import { StatCard } from '../components/common';
import type { Expense } from '../api/types';
import { expenseFields, expenseDefaults } from '../utils/forms';
import { money, fmtDate } from '../utils/format';
import { fileUrl } from '../api/client';
import { useLookupMaps, useSettings, useClients } from '../hooks/useLookups';

export default function Expenses() {
  const { categories, catById } = useLookupMaps();
  const settings = useSettings();
  const nav = useNavigate();
  const contractors = (useClients().data ?? []).filter((c) => c.type === 'contractor');
  const contractorName = (id?: string | null) => (id ? contractors.find((c) => c.id === id)?.name : undefined);
  const config: ResourceConfig<Expense> = {
    queryKey: 'expenses', endpoint: '/expenses', title: 'Expenses', singular: 'Expense',
    fields: expenseFields, defaults: expenseDefaults, dateFilter: true,
    headerActions: <Button startIcon={<DocumentScannerOutlinedIcon />} onClick={() => nav('/receipts?upload=1')}>Scan a receipt</Button>,
    filters: [
      { name: 'categoryId', label: 'Category', options: categories.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'paymentMethod', label: 'Payment', options: (settings.data?.paymentMethods ?? []).map((p) => ({ value: p, label: p })) },
      { name: 'contractorId', label: 'Contractor', options: contractors.map((c) => ({ value: c.id, label: c.name })) },
    ],
    columns: [
      { key: 'date', label: 'Date', render: (e) => fmtDate(e.date, 'ddd D MMM YYYY') },
      { key: 'category', label: 'Category', render: (e) => { const c = e.categoryId ? catById.get(e.categoryId) : undefined; return c ? <Chip size="small" label={c.name} icon={<Box component="span" sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: c.color, ml: '8px !important' }} />} variant="outlined" /> : '—'; }, sortValue: (e) => (e.categoryId ? catById.get(e.categoryId)?.name ?? '' : '') },
      { key: 'merchant', label: 'Merchant', render: (e) => <><Typography variant="body2" fontWeight={500}>{e.merchant ?? '—'}</Typography>{e.description && e.description !== e.merchant && <Typography variant="caption" color="text.secondary">{e.description}</Typography>}</> },
      { key: 'contractor', label: 'Contractor', render: (e) => (contractorName(e.contractorId) ? <Chip size="small" variant="outlined" color="secondary" label={contractorName(e.contractorId)} /> : '—'), sortValue: (e) => contractorName(e.contractorId) ?? '' },
      { key: 'paymentMethod', label: 'Payment', render: (e) => e.paymentMethod ?? '—' },
      { key: 'receipt', label: '', render: (e) => (e.receiptId ? <a href={fileUrl(`/documents/${e.receiptId}/file`)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} aria-label="View receipt"><ReceiptOutlinedIcon fontSize="small" color="action" /></a> : e.billId ? <Chip size="small" label="Bill" variant="outlined" /> : null) },
      { key: 'amount', label: 'Amount', align: 'right', render: (e) => <Typography variant="body2" fontWeight={600}>{money(e.amount)}</Typography>, sortValue: (e) => e.amount },
    ],
    mobileTitle: (e) => e.merchant ?? e.description ?? 'Expense',
    mobileSubtitle: (e) => [fmtDate(e.date), e.categoryId ? catById.get(e.categoryId)?.name : '', contractorName(e.contractorId) ? `for ${contractorName(e.contractorId)}` : ''].filter(Boolean).join(' · '),
    mobileRight: (e) => <Typography variant="body2" fontWeight={600}>{money(e.amount)}</Typography>,
    summary: (items) => {
      const total = items.reduce((a, e) => a + e.amount, 0);
      const byCat = new Map<string, number>();
      for (const e of items) byCat.set(e.categoryId ?? '', (byCat.get(e.categoryId ?? '') ?? 0) + e.amount);
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 4 }}><StatCard label="Total spent" value={money(total)} tone="negative" /></Grid>
          <Grid size={{ xs: 6, md: 4 }}><StatCard label="Transactions" value={items.length} hint={items.length ? `${money(total / items.length)} average` : undefined} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><StatCard label="Largest category" value={top ? catById.get(top[0])?.name ?? 'Uncategorised' : '—'} hint={top ? money(top[1]) : undefined} /></Grid>
        </Grid>
      );
    },
  };
  return <ResourcePage config={config} />;
}
