import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Link, Typography, Stack, Chip, Snackbar } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import UpdateOutlinedIcon from '@mui/icons-material/UpdateOutlined';
import RecordPayDialog from '../components/RecordPayDialog';
import { ResourcePage, type ResourceConfig } from '../components/ResourcePage';
import { StatusChip, StatCard } from '../components/common';
import type { Job } from '../api/types';
import { jobFields, jobDefaults, withFormattedAddress } from '../utils/forms';
import { money, fmtDate, fmtTime, mapsUrl } from '../utils/format';
import { patch, post } from '../api/client';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import { useLookupMaps } from '../hooks/useLookups';
import { Grid } from '@mui/material';

export default function Jobs() {
  const nav = useNavigate();
  const invalidate = useInvalidateFinance();
  const toast = useToast();
  const { sources, srcById } = useLookupMaps();
  const [payOpen, setPayOpen] = useState<false | 'paid' | 'expected'>(false);
  const amountCell = (j: Job) => (noPay(j) ? payChip : j.amountEstimated ? <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end"><span>{money(j.amount)}</span><Chip size="small" variant="outlined" color="info" label="Expected" /></Stack> : money(j.amount));
  const noPay = (j: Job) => !j.amount && j.status !== 'cancelled';
  const payChip = <Chip size="small" color="warning" variant="outlined" label="Pay not set" />;
  const setStatus = async (j: Job, status: Job['status']) => {
    await patch(`/jobs/${j.id}`, { status });
    invalidate();
    toast(`Job marked ${status}`);
  };
  // Swipe to complete, with a way back if it was a slip of the finger
  const [undo, setUndo] = useState<{ job: Job; was: Job['status'] } | null>(null);
  const complete = async (j: Job) => {
    try { await patch(`/jobs/${j.id}`, { status: 'completed' }); await invalidate(); setUndo({ job: j, was: j.status }); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const undoComplete = async () => {
    if (!undo) return;
    const u = undo; setUndo(null);
    try { await patch(`/jobs/${u.job.id}`, { status: u.was }); invalidate(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const bulk = async (rows: Job[], action: 'completed' | 'paid') => {
    const r = await post<{ updated: number; skipped: { cancelled: number; noPay: number } }>('/jobs/bulk', { jobIds: rows.map((j) => j.id), action });
    await invalidate();
    const notes = [r.skipped.noPay ? `${r.skipped.noPay} skipped: pay not set (use Record pay)` : '', r.skipped.cancelled ? `${r.skipped.cancelled} skipped: cancelled` : ''].filter(Boolean).join(' · ');
    const same = rows.length - r.updated - r.skipped.noPay - r.skipped.cancelled;
    toast(`${r.updated} job${r.updated === 1 ? '' : 's'} marked ${action}${same > 0 ? ` · ${same} already ${action}` : ''}${notes ? ` · ${notes}` : ''}`, notes && !r.updated ? 'error' : undefined);
  };
  const config: ResourceConfig<Job> = {
    queryKey: 'jobs', endpoint: '/jobs', title: 'Jobs', singular: 'Job',
    subtitle: 'Own-business jobs are billed to the client; jobs under a contractor are billed to the contractor; employee shifts are paid as wages. If you don’t know the pay yet, set an expected amount now and record the real pay later.',
    fields: jobFields, defaults: jobDefaults, dateFilter: true, transform: withFormattedAddress,
    fromRecord: (j) => ({ ...j, address: j.address ?? {}, tasks: j.tasks ?? [] }),
    filters: [
      // Completed jobs are hidden until asked for; the totals above still count them
      { name: 'status', label: 'Status', defaultValue: 'open', clientSide: (j, v) => (v === 'open' ? j.status !== 'completed' : j.status === v),
        options: [{ value: 'open', label: 'Not completed' }, ...['scheduled', 'in_progress', 'completed', 'cancelled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))] },
      { name: 'incomeSourceId', label: 'Source', options: sources.map((s) => ({ value: s.id, label: s.name })) },
      { name: 'workType', label: 'Working as', options: [{ value: 'own', label: 'Own business' }, { value: 'subcontract', label: 'Under a contractor' }, { value: 'employee', label: 'Employee' }] },
      { name: 'pay', label: 'Pay', options: [{ value: 'unset', label: 'Waiting for actual pay' }, { value: 'set', label: 'Actual pay recorded' }] },
    ],
    headerActions: <><Button startIcon={<PaidOutlinedIcon />} onClick={() => setPayOpen('paid')}>Record pay</Button><Button startIcon={<UpdateOutlinedIcon />} onClick={() => setPayOpen('expected')}>Expected pay</Button><Button startIcon={<ContentPasteGoIcon />} onClick={() => nav('/import')}>Paste or upload</Button></>,
    columns: [
      { key: 'date', label: 'Date', render: (j) => <>{fmtDate(j.date, 'ddd D MMM')}<Typography variant="caption" color="text.secondary" component="div">{fmtTime(j.startTime)}{j.endTime ? `–${fmtTime(j.endTime)}` : ''}</Typography></>, sortValue: (j) => j.date + (j.startTime ?? '') },
      { key: 'clientName', label: 'Client', render: (j) => <><Typography variant="body2" fontWeight={500}>{j.clientName ?? j.title ?? '—'}</Typography><Typography variant="caption" color="text.secondary">{[j.incomeSourceId && srcById.get(j.incomeSourceId)?.name, j.workType === 'subcontract' ? `via ${j.contractorName ?? 'contractor'}` : null].filter(Boolean).join(' · ')}</Typography></> },
      { key: 'workType', label: 'Bill to', render: (j) => (j.workType === 'employee' ? <Chip size="small" color="info" variant="outlined" label="Wages" /> : j.workType === 'subcontract' ? <Chip size="small" color="secondary" variant="outlined" label={j.contractorName ?? 'Contractor'} /> : <Chip size="small" variant="outlined" label="Client" />), sortValue: (j) => (j.workType === 'subcontract' ? j.contractorName ?? 'zz' : '') },
      { key: 'address', label: 'Address', render: (j) => (j.address?.formatted ? <Link href={mapsUrl(j.address.formatted)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} underline="hover" color="inherit">{j.address.formatted}</Link> : '—'), sortValue: (j) => j.address?.suburb ?? '' },
      { key: 'amount', label: 'Amount', align: 'right', render: amountCell, sortValue: (j) => j.amount ?? 0 },
      { key: 'travel', label: 'Drive', align: 'right', render: (j) => (j.distanceKm !== undefined && j.distanceKm !== null ? <Typography variant="body2" color="text.secondary" noWrap>{j.distanceKm ? `${j.distanceKm.toFixed(1)} km · ${j.travelMinutes ?? 0} min` : 'start'}</Typography> : '—'), sortValue: (j) => j.distanceKm ?? -1 },
      { key: 'hoursWorked', label: 'Hours', align: 'right', render: (j) => j.hoursWorked ? j.hoursWorked.toFixed(1) : '—' },
      { key: 'status', label: 'Status', render: (j) => <Stack direction="row" spacing={0.5}><StatusChip status={j.status} />{j.invoiceId && <Chip size="small" label="Invoiced" variant="outlined" />}</Stack> },
    ],
    mobileTitle: (j) => j.clientName ?? 'Job',
    mobileSubtitle: (j) => `${fmtDate(j.date, 'ddd D MMM')} ${fmtTime(j.startTime)} · ${j.address?.suburb ?? ''}${j.workType === 'subcontract' ? ` · via ${j.contractorName ?? 'contractor'}` : ''}`,
    mobileRight: (j) => <>{noPay(j) ? payChip : <Typography variant="body2" fontWeight={600}>{money(j.amount)}{j.amountEstimated ? ' est.' : ''}</Typography>}<Box sx={{ mt: 0.25 }}><StatusChip status={j.status} /></Box></>,
    rowActions: [
      { label: 'Mark completed', icon: <CheckCircleOutlineIcon fontSize="small" />, onClick: (j) => setStatus(j, 'completed'), show: (j) => j.status !== 'completed' },
      { label: 'Cancel job', icon: <CancelOutlinedIcon fontSize="small" />, onClick: (j) => setStatus(j, 'cancelled'), show: (j) => j.status !== 'cancelled' },
      { label: 'Open in Google Maps', icon: <PlaceOutlinedIcon fontSize="small" />, onClick: (j) => { window.open(mapsUrl(j.address?.formatted), '_blank'); }, show: (j) => !!j.address?.formatted },
    ],
    swipe: { label: 'Completed', onAction: complete, show: (j) => j.status !== 'completed' && j.status !== 'cancelled' },
    bulkActions: [
      { label: 'Mark completed', icon: <CheckCircleOutlineIcon fontSize="small" />, onClick: (rows) => bulk(rows, 'completed'), variant: 'contained' },
      { label: 'Mark paid', icon: <PaidOutlinedIcon fontSize="small" />, onClick: (rows) => bulk(rows, 'paid') },
    ],
    deleteMessage: () => 'The linked income record is removed too (unless it is already paid).',
    summary: (items) => {
      const done = items.filter((j) => j.status === 'completed');
      const amt = done.reduce((a, j) => a + (j.amount ?? 0), 0);
      const hrs = done.reduce((a, j) => a + (j.hoursWorked ?? 0), 0);
      return (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 3 }}><StatCard label="Jobs" value={items.length} hint={`${done.length} completed`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatCard label="Completed income" value={money(amt)} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatCard label="Avg per job" value={done.length ? money(amt / done.length) : '—'} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatCard label="Avg per hour" value={hrs ? money(amt / hrs) : '—'} hint={`${hrs.toFixed(1)} hours`} /></Grid>
        </Grid>
      );
    },
  };
  return <><ResourcePage config={config} />
    <Snackbar open={!!undo} autoHideDuration={6000} onClose={(_, reason) => { if (reason !== 'clickaway') setUndo(null); }} message={undo ? `${undo.job.clientName ?? undo.job.title ?? 'Job'} marked completed` : ''} action={<Button color="inherit" size="small" onClick={undoComplete}>Undo</Button>} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ mb: { xs: 9, md: 0 } }} />
    <RecordPayDialog open={!!payOpen} initialMode={payOpen || 'paid'} onClose={() => setPayOpen(false)} /></>;
}
