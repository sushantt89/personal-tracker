import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Card, CardContent, Grid, TextField, Button, Stack, Typography, IconButton, Table, TableHead, TableRow, TableCell, TableBody, Alert, MenuItem,
  Checkbox, FormControlLabel, Switch, Divider, Collapse, Autocomplete, Dialog, DialogContent, DialogTitle, DialogActions, Tooltip, InputAdornment, useMediaQuery, useTheme, ToggleButtonGroup, ToggleButton, Menu, ListItemIcon, ListItemText,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddToDriveIcon from '@mui/icons-material/AddToDrive';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { get, post, put, fileUrl } from '../api/client';
import type { Invoice, InvoiceItem, Job, Client, InvoiceTemplate } from '../api/types';
import { PageHeader, StatusChip, LoadingBlock, useConfirm } from '../components/common';
import { money, fmtDate, fmtShort, localToday, addDays, startOfMonth, endOfMonth } from '../utils/format';
import { useClients, useIncomeSources, useSettings, useIntegrations } from '../hooks/useLookups';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import { markInvoicePaid, setInvoiceStatus, sendInvoice, sentMessage } from './invoiceActions';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import dayjs from 'dayjs';

interface Form {
  number: string; issueDate: string; dueDate: string; incomeSourceId: string; clientId: string; clientName: string; clientAddress: string; clientEmail: string; billToType: 'client' | 'contractor';
  items: InvoiceItem[]; gstRate: number; notes: string; paymentDetails: string; periodFrom?: string; periodTo?: string;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function InvoiceEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const settings = useSettings();
  const clients = useClients();
  const integrations = useIntegrations();
  const [uploading, setUploading] = useState(false);
  const sources = useIncomeSources();
  const existing = useQuery({ queryKey: ['invoices', 'one', id], queryFn: () => get<Invoice>(`/invoices/${id}`), enabled: !!id });
  const nextNumber = useQuery({ queryKey: ['invoices', 'next-number'], queryFn: () => get<{ number: string }>('/invoices/next-number'), enabled: !id });
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  // Straight after creating an invoice: offer to send it or keep editing
  const loc = useLocation() as { state?: { justCreated?: boolean } };
  const [created, setCreated] = useState(Boolean(loc.state?.justCreated));
  useEffect(() => { if (loc.state?.justCreated) { setCreated(true); nav('.', { replace: true, state: null }); } }, [loc.state?.justCreated]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showGen, setShowGen] = useState(params.get('generate') === '1');
  const templates = useQuery({ queryKey: ['invoice-templates'], queryFn: () => get<{ items: InvoiceTemplate[] }>('/invoice-templates') });
  const [tplMenu, setTplMenu] = useState<HTMLElement | null>(null);
  const [saveTpl, setSaveTpl] = useState<{ name: string; includeItems: boolean } | null>(null);
  const [appliedParamTpl, setAppliedParamTpl] = useState(false);

  // Generator state
  const [gen, setGen] = useState({ billTo: 'client' as 'client' | 'contractor', contractorId: '', incomeSourceId: '', clientId: '', from: startOfMonth(dayjs(localToday()).subtract(1, 'month').format('YYYY-MM-DD')), to: endOfMonth(dayjs(localToday()).subtract(1, 'month').format('YYYY-MM-DD')), includeScheduled: false });
  const [candidates, setCandidates] = useState<Job[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Re-initialise when navigating between invoices (e.g. after the first save)
  useEffect(() => { setForm(null); }, [id]);
  useEffect(() => {
    if (form) return;
    const s = settings.data?.invoice;
    if (id && existing.data) {
      const i = existing.data;
      setForm({ number: i.number, issueDate: i.issueDate, dueDate: i.dueDate ?? '', incomeSourceId: i.incomeSourceId ?? '', clientId: i.clientId ?? '', clientName: i.clientName, billToType: i.billToType ?? 'client', clientAddress: i.clientAddress ?? '', clientEmail: i.clientEmail ?? '', items: i.items, gstRate: i.gstRate, notes: i.notes ?? '', paymentDetails: i.paymentDetails ?? '', periodFrom: i.periodFrom, periodTo: i.periodTo });
    } else if (!id && settings.data) {
      const today = localToday();
      setForm({ number: '', issueDate: today, dueDate: addDays(today, s?.paymentTermsDays ?? 7), incomeSourceId: '', clientId: '', clientName: '', billToType: 'client', clientAddress: '', clientEmail: '', items: [{ description: '', quantity: 1, rate: 0 }], gstRate: s?.gstRegistered ? s.gstRate : 0, notes: s?.defaultNotes ?? '', paymentDetails: s?.paymentDetails ?? '' });
    }
  }, [id, existing.data, settings.data, form]);

  // New invoice from a template: /invoices/new?template=<id>
  useEffect(() => {
    const tid = params.get('template');
    if (id || !tid || appliedParamTpl || !form || !templates.data) return;
    const t = templates.data.items.find((x) => x.id === tid);
    if (t) applyTemplate(t, true);
    setAppliedParamTpl(true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function applyTemplate(t: InvoiceTemplate, quiet = false) {
    setForm((f) => {
      if (!f) return f;
      const keep = f.items.filter((i) => i.description.trim() || Number(i.rate));
      const tplItems: InvoiceItem[] = (t.items ?? []).map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, date: f.issueDate }));
      return {
        ...f,
        billToType: t.billToType ?? 'client',
        clientId: t.clientId ?? '', clientName: t.clientName ?? f.clientName, clientAddress: t.clientAddress ?? '', clientEmail: t.clientEmail ?? '',
        incomeSourceId: t.incomeSourceId ?? f.incomeSourceId,
        items: tplItems.length ? [...keep, ...tplItems] : f.items,
        gstRate: t.gstRate ?? f.gstRate,
        notes: t.notes ?? f.notes, paymentDetails: t.paymentDetails ?? f.paymentDetails,
        dueDate: t.paymentTermsDays !== undefined && t.paymentTermsDays !== null ? addDays(f.issueDate, t.paymentTermsDays) : f.dueDate,
      };
    });
    if (!quiet) toast(`Template "${t.name}" applied`, 'info');
  }

  const totals = useMemo(() => {
    const subtotal = r2((form?.items ?? []).reduce((a, i) => a + r2((Number(i.quantity) || 0) * (Number(i.rate) || 0)), 0));
    const gst = r2((subtotal * (Number(form?.gstRate) || 0)) / 100);
    return { subtotal, gst, total: r2(subtotal + gst) };
  }, [form]);

  if ((id && existing.isLoading) || !form) return <LoadingBlock rows={6} height={60} />;
  const inv = existing.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setItem = (idx: number, patchItem: Partial<InvoiceItem>) => set('items', form.items.map((it, i) => (i === idx ? { ...it, ...patchItem } : it)));
  const pickClient = (c: Client | string | null) => {
    if (c && typeof c === 'object') setForm((f) => f && ({ ...f, billToType: c.type === 'contractor' ? 'contractor' : 'client', clientId: c.id, clientName: c.name, clientAddress: c.address?.formatted ?? f.clientAddress, clientEmail: c.email ?? f.clientEmail, incomeSourceId: f.incomeSourceId || (c.incomeSourceId ?? '') }));
    else setForm((f) => f && ({ ...f, clientId: '', clientName: c ?? '' }));
  };

  const findJobs = async () => {
    setError(null);
    try {
      const r = await get<{ items: Job[]; total: number }>('/invoices/candidates', { from: gen.from, to: gen.to, incomeSourceId: gen.incomeSourceId, workType: gen.billTo === 'contractor' ? 'subcontract' : 'own', ...(gen.billTo === 'contractor' ? { contractorId: gen.contractorId } : { clientId: gen.clientId }), includeScheduled: gen.includeScheduled ? 'true' : 'false' });
      setCandidates(r.items);
      setSelected(new Set(r.items.map((j) => j.id)));
    } catch (e) { setError((e as Error).message); }
  };
  const addSelected = () => {
    const chosen = (candidates ?? []).filter((j) => selected.has(j.id));
    const srcName = (sid?: string | null) => sources.data?.find((s) => s.id === (sid || gen.incomeSourceId))?.name ?? 'Service';
    const newItems: InvoiceItem[] = chosen.map((j) => ({ date: j.date, description: `${srcName(j.incomeSourceId)} – ${j.clientName ?? 'Job'}${j.address?.suburb ? ', ' + j.address.suburb : ''}${j.startTime ? ' (' + j.startTime + ')' : ''}`, quantity: 1, rate: j.amount ?? 0, jobId: j.id }));
    const existingItems = form.items.filter((i) => i.description.trim() || i.rate);
    // Bill the contractor for work done under them; bill the client for your own jobs
    const contractorIds = new Set(chosen.map((j) => j.contractorId).filter(Boolean));
    const billToId = gen.billTo === 'contractor' ? gen.contractorId || (contractorIds.size === 1 ? [...contractorIds][0] : '') : gen.clientId;
    const billTo = clients.data?.find((c) => c.id === billToId);
    setForm((f) => f && ({
      ...f, items: [...existingItems.filter((i) => !newItems.some((n) => n.jobId && n.jobId === i.jobId)), ...newItems], periodFrom: gen.from, periodTo: gen.to,
      incomeSourceId: f.incomeSourceId || gen.incomeSourceId, billToType: gen.billTo,
      ...(billTo ? { clientId: billTo.id, clientName: billTo.name, clientAddress: billTo.address?.formatted ?? '', clientEmail: billTo.email ?? '' } : {}),
    }));
    if (gen.billTo === 'contractor' && contractorIds.size > 1) toast('These jobs are for more than one contractor — consider one invoice per contractor', 'warning');
    setShowGen(false);
    toast(`${newItems.length} job(s) added — review the invoice before saving`, 'info');
  };

  const save = async (status?: 'draft' | 'sent') => {
    setSaving(true); setError(null);
    try {
      const body = { ...form, number: form.number || undefined, incomeSourceId: form.incomeSourceId || null, clientId: form.clientId || null, gstRate: Number(form.gstRate) || 0,
        items: form.items.filter((i) => i.description.trim()).map((i) => ({ date: i.date || undefined, description: i.description, quantity: Number(i.quantity) || 0, rate: Number(i.rate) || 0, jobId: i.jobId || null })),
        ...(status ? { status } : {}) };
      const saved = id ? await put<Invoice>(`/invoices/${id}`, body) : await post<Invoice>('/invoices', { ...body, status: status ?? 'draft' });
      invalidate();
      toast(`Invoice ${saved.number} saved`);
      if (!id) nav(`/invoices/${saved.id}`, { replace: true, state: { justCreated: true } });
      else { setForm(null); existing.refetch(); }
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const sendNow = async () => {
    if (!inv || sending) return;
    setSending(true);
    try { const r = await sendInvoice(inv); invalidate(); setForm(null); existing.refetch(); { const m = sentMessage(inv, r); toast(m.text, m.severity); }; }
    catch (e) { toast((e as Error).message, 'error'); }
    setSending(false);
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); invalidate(); existing.refetch(); toast(msg); } catch (e) { toast((e as Error).message, 'error'); } };
  const saveTemplate = async () => {
    if (!saveTpl?.name.trim()) return;
    const terms = form.dueDate ? Math.max(0, dayjs(form.dueDate).diff(dayjs(form.issueDate), 'day')) : undefined;
    try {
      await post('/invoice-templates', {
        name: saveTpl.name.trim(), billToType: form.billToType, clientId: form.clientId || null, clientName: form.clientName, clientAddress: form.clientAddress, clientEmail: form.clientEmail,
        incomeSourceId: form.incomeSourceId || null, gstRate: Number(form.gstRate) || 0, paymentTermsDays: terms, notes: form.notes, paymentDetails: form.paymentDetails,
        // Job-linked lines are specific to one invoice, so only reusable lines are saved
        items: saveTpl.includeItems ? form.items.filter((i) => i.description.trim() && !i.jobId).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 0, rate: Number(i.rate) || 0 })) : [],
      });
      templates.refetch();
      toast(`Template "${saveTpl.name.trim()}" saved`);
      setSaveTpl(null);
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const allSelectedTotal = (candidates ?? []).filter((j) => selected.has(j.id)).reduce((a, j) => a + (j.amount ?? 0), 0);

  return (
    <Box>
      <PageHeader
        title={id ? `Invoice ${inv?.number}` : 'New invoice'}
        subtitle={inv ? <Stack direction="row" spacing={1} alignItems="center" component="span"><StatusChip status={inv.effectiveStatus} /><span>Total {money(inv.total)}{inv.paidDate ? ` · paid ${fmtDate(inv.paidDate)}` : ''}</span></Stack> : 'Fill in the details, or generate items from completed jobs.'}
        actions={<>
          <Button startIcon={<ArrowBackIcon />} onClick={() => nav('/invoices')}>Back</Button>
          <Button startIcon={<BookmarksOutlinedIcon />} onClick={(e) => setTplMenu(e.currentTarget)}>Templates</Button>
          {inv && <>
            <Button startIcon={<VisibilityOutlinedIcon />} onClick={() => setPreview(true)}>Preview</Button>
            <Button startIcon={<PictureAsPdfOutlinedIcon />} href={fileUrl(`/invoices/${inv.id}/pdf`, { download: 1 })}>PDF</Button>
            {inv.status !== 'cancelled' && <Button variant="contained" startIcon={<EmailOutlinedIcon />} disabled={sending} onClick={sendNow}>{inv.sentAt ? 'Send again' : 'Send'}</Button>}
            {inv.status === 'draft' && <Button startIcon={<SendOutlinedIcon />} onClick={() => act(() => setInvoiceStatus(inv, 'sent'), 'Marked as sent')}>Mark sent</Button>}
            {inv.status !== 'paid' && <Button color="success" startIcon={<CheckCircleOutlineIcon />} onClick={() => act(() => markInvoicePaid(inv, confirm), 'Marked as paid — its jobs and their income are marked paid too')}>Mark paid</Button>}
            {inv.status === 'paid' && <Button onClick={() => act(() => setInvoiceStatus(inv, 'sent', true), 'Marked as unpaid')}>Mark unpaid</Button>}
            <Button startIcon={<ContentCopyIcon />} onClick={() => act(async () => { const c = await post<Invoice>(`/invoices/${inv.id}/duplicate`); setForm(null); nav(`/invoices/${c.id}`); }, 'Duplicated')}>Duplicate</Button>
            {inv.sync?.googleDriveLink && <Button startIcon={<AddToDriveIcon />} href={inv.sync.googleDriveLink} target="_blank">Open in Google Drive</Button>}
            <Tooltip title={integrations.data?.googleDrive.connected ? (inv.sync?.googleDriveFileId ? 'Replace the Drive copy with the current version' : 'Upload the PDF to Personal Finance/Invoices') : 'Connect Google Drive in Settings → Integrations'}>
              <span><Button startIcon={<AddToDriveIcon />} disabled={!integrations.data?.googleDrive.connected || uploading}
                onClick={async () => { setUploading(true); await act(() => post(`/invoices/${inv.id}/drive`), inv.sync?.googleDriveFileId ? 'Drive copy updated' : 'Saved to Google Drive'); setUploading(false); }}>
                {uploading ? 'Uploading…' : inv.sync?.googleDriveFileId ? 'Update in Drive' : 'Save to Drive'}
              </Button></span>
            </Tooltip>
          </>}
        </>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>Generate from jobs</Typography>
              <Typography variant="body2" color="text.secondary">Find completed jobs that aren't invoiced yet, for a source, client and date range.</Typography>
            </Box>
            <Button startIcon={<AutoAwesomeIcon />} onClick={() => setShowGen((s) => !s)}>{showGen ? 'Hide' : 'Show'}</Button>
          </Stack>
          <Collapse in={showGen}>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={12}>
                <ToggleButtonGroup exclusive size="small" value={gen.billTo} onChange={(_, v) => { if (v) { setGen({ ...gen, billTo: v }); setCandidates(null); } }}>
                  <ToggleButton value="client">Bill a client (my own jobs)</ToggleButton>
                  <ToggleButton value="contractor">Bill a contractor (jobs I did under them)</ToggleButton>
                </ToggleButtonGroup>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField select label="Income source" value={gen.incomeSourceId} onChange={(e) => setGen({ ...gen, incomeSourceId: e.target.value })}>
                  <MenuItem value="">All sources</MenuItem>
                  {(sources.data ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                {gen.billTo === 'contractor' ? (
                  <TextField select label="Contractor" value={gen.contractorId} onChange={(e) => setGen({ ...gen, contractorId: e.target.value })}>
                    <MenuItem value="">All contractors</MenuItem>
                    {(clients.data ?? []).filter((c) => c.type === 'contractor').map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </TextField>
                ) : (
                  <TextField select label="Client" value={gen.clientId} onChange={(e) => setGen({ ...gen, clientId: e.target.value })}>
                    <MenuItem value="">All clients</MenuItem>
                    {(clients.data ?? []).filter((c) => c.type !== 'contractor').map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </TextField>
                )}
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField type="date" label="From" value={gen.from} onChange={(e) => setGen({ ...gen, from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField type="date" label="To" value={gen.to} onChange={(e) => setGen({ ...gen, to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button fullWidth variant="contained" onClick={findJobs} sx={{ height: 40 }}>Find jobs</Button></Grid>
              <Grid size={12}><FormControlLabel control={<Switch checked={gen.includeScheduled} onChange={(e) => setGen({ ...gen, includeScheduled: e.target.checked })} />} label="Include jobs not yet marked completed" /></Grid>
            </Grid>
            {candidates && (
              <Box sx={{ mt: 1 }}>
                {!candidates.length ? <Alert severity="info">No un-invoiced jobs found for this selection.</Alert> : (
                  <>
                    <Table size="small">
                      <TableHead><TableRow>
                        <TableCell padding="checkbox"><Checkbox checked={selected.size === candidates.length} indeterminate={selected.size > 0 && selected.size < candidates.length} onChange={(e) => setSelected(e.target.checked ? new Set(candidates.map((j) => j.id)) : new Set())} /></TableCell>
                        <TableCell>Date</TableCell><TableCell>Client</TableCell>{gen.billTo === 'contractor' && <TableCell>Contractor</TableCell>}{!mobile && <TableCell>Address</TableCell>}<TableCell align="right">Amount</TableCell>
                      </TableRow></TableHead>
                      <TableBody>
                        {candidates.map((j) => (
                          <TableRow key={j.id} hover onClick={() => setSelected((s) => { const n = new Set(s); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })} sx={{ cursor: 'pointer' }}>
                            <TableCell padding="checkbox"><Checkbox checked={selected.has(j.id)} /></TableCell>
                            <TableCell>{fmtShort(j.date)}</TableCell><TableCell>{j.clientName}</TableCell>{gen.billTo === 'contractor' && <TableCell>{j.contractorName ?? '—'}</TableCell>}{!mobile && <TableCell>{j.address?.formatted}</TableCell>}
                            <TableCell align="right">{money(j.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2">{selected.size} selected · Total {money(allSelectedTotal)}</Typography>
                      <Button variant="contained" disabled={!selected.size} onClick={addSelected}>Add to invoice</Button>
                    </Stack>
                  </>
                )}
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}><TextField label="Invoice number" value={form.number} placeholder={nextNumber.data?.number ? `Auto: ${nextNumber.data.number}` : 'Auto'} onChange={(e) => set('number', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 6, sm: 4 }}><TextField type="date" label="Issue date" value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 6, sm: 4 }}><TextField type="date" label="Due date (optional)" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.issueDate } }} helperText={form.dueDate ? <Box component="span" role="button" tabIndex={0} sx={{ color: 'primary.main', cursor: 'pointer' }} onClick={() => set('dueDate', '')} onKeyDown={(e) => { if (e.key === 'Enter') set('dueDate', ''); }}>Remove due date</Box> : 'None — it won’t be marked overdue'} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete freeSolo options={clients.data ?? []} getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)} value={clients.data?.find((c) => c.id === form.clientId) ?? form.clientName}
                onChange={(_, v) => pickClient(v as Client | string | null)} onInputChange={(_, v, reason) => reason === 'input' && pickClient(v)}
                renderInput={(p) => <TextField {...p} label={form.billToType === 'contractor' ? 'Bill to (contractor)' : 'Bill to (client)'} required />} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField select label="Income source" value={form.incomeSourceId} onChange={(e) => set('incomeSourceId', e.target.value)}>
                <MenuItem value="">None</MenuItem>
                {(sources.data ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Client address" value={form.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} multiline /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Client email" value={form.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} /></Grid>
          </Grid>

          <Divider sx={{ my: 2.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Items{form.periodFrom && form.periodTo ? ` · period ${fmtShort(form.periodFrom)} – ${fmtDate(form.periodTo)}` : ''}</Typography>
          <Stack spacing={1.5}>
            {form.items.map((it, idx) => (
              <Grid container spacing={1} key={idx} alignItems="center">
                <Grid size={{ xs: 6, md: 2 }}><TextField type="date" label="Date" value={it.date ?? ''} onChange={(e) => setItem(idx, { date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
                <Grid size={{ xs: 12, md: 5 }} order={{ xs: -1, md: 0 }}><TextField label="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} helperText={it.jobId ? 'Linked to a job' : undefined} /></Grid>
                <Grid size={{ xs: 2, md: 1 }}><TextField type="number" label="Qty" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value as unknown as number })} slotProps={{ htmlInput: { min: 0, step: 'any' } }} /></Grid>
                <Grid size={{ xs: 4, md: 2 }}><TextField type="number" label="Rate" value={it.rate} onChange={(e) => setItem(idx, { rate: e.target.value as unknown as number })} slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01' } }} /></Grid>
                <Grid size={{ xs: 10, md: 1.5 }} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight={600}>{money(r2((Number(it.quantity) || 0) * (Number(it.rate) || 0)))}</Typography></Grid>
                <Grid size={{ xs: 2, md: 0.5 }}><IconButton aria-label="Remove item" size="small" onClick={() => set('items', form.items.filter((_, i) => i !== idx))}><DeleteOutlineIcon fontSize="small" /></IconButton></Grid>
              </Grid>
            ))}
          </Stack>
          <Button startIcon={<AddIcon />} sx={{ mt: 1.5 }} onClick={() => set('items', [...form.items, { description: '', quantity: 1, rate: 0, date: localToday() }])}>Add item</Button>

          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Stack spacing={2}>
                <TextField label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} multiline minRows={2} />
                <TextField label="Payment details" value={form.paymentDetails} onChange={(e) => set('paymentDetails', e.target.value)} multiline minRows={2} helperText="Defaults come from Settings → Invoice" />
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Subtotal</Typography><Typography variant="body2">{money(totals.subtotal)}</Typography></Stack>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <TextField type="number" label="GST %" value={form.gstRate} onChange={(e) => set('gstRate', e.target.value as unknown as number)} sx={{ width: 100 }} slotProps={{ htmlInput: { min: 0, max: 100 } }} />
                    <Typography variant="body2">{money(totals.gst)}</Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle1" fontWeight={700}>Total</Typography><Typography variant="subtitle1" fontWeight={700}>{money(totals.total)}</Typography></Stack>
                </Stack>
              </Card>
            </Grid>
          </Grid>
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 3 }}>
            <Button variant="outlined" disabled={saving} onClick={() => save()}>{id ? 'Save changes' : 'Save draft'}</Button>
            {!id && <Button variant="contained" disabled={saving} onClick={() => save('sent')}>Save & mark sent</Button>}
          </Stack>
        </CardContent>
      </Card>

      <Menu anchorEl={tplMenu} open={!!tplMenu} onClose={() => setTplMenu(null)}>
        {(templates.data?.items ?? []).map((t) => (
          <MenuItem key={t.id} onClick={() => { setTplMenu(null); applyTemplate(t); }}>
            <ListItemIcon><DescriptionOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={`Use: ${t.name}`} secondary={[t.clientName, t.items?.length ? `${t.items.length} item(s)` : null].filter(Boolean).join(' · ')} />
          </MenuItem>
        ))}
        {!!templates.data?.items.length && <Divider />}
        <MenuItem onClick={() => { setTplMenu(null); setSaveTpl({ name: form.clientName ? `${form.clientName} invoice` : '', includeItems: true }); }}>
          <ListItemIcon><BookmarkAddOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Save current as template…" secondary="Bill-to details, standard items, GST, notes and terms" />
        </MenuItem>
      </Menu>

      <Dialog open={!!saveTpl} onClose={() => setSaveTpl(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Save as template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField autoFocus label="Template name" value={saveTpl?.name ?? ''} onChange={(e) => setSaveTpl((s) => s && { ...s, name: e.target.value })} placeholder="e.g. Weekly cleaning – Sparkle Agency" />
            <FormControlLabel control={<Checkbox checked={!!saveTpl?.includeItems} onChange={(e) => setSaveTpl((s) => s && { ...s, includeItems: e.target.checked })} />} label="Include line items (lines linked to jobs are skipped)" />
            <Typography variant="caption" color="text.secondary">Saved: bill-to {form.billToType === 'contractor' ? 'contractor' : 'client'} ({form.clientName || 'none'}), income source, GST {Number(form.gstRate) || 0}%, payment terms, notes and payment details.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTpl(null)}>Cancel</Button>
          <Button variant="contained" disabled={!saveTpl?.name.trim()} onClick={saveTemplate}>Save template</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={preview} onClose={() => setPreview(false)} maxWidth="md" fullWidth fullScreen={mobile}>
        <DialogTitle>Preview · {inv?.number}</DialogTitle>
        <DialogContent sx={{ p: 0, height: '80vh' }}>
          {inv && <iframe title="Invoice PDF preview" src={fileUrl(`/invoices/${inv.id}/pdf`)} style={{ border: 0, width: '100%', height: '100%' }} />}
        </DialogContent>
      </Dialog>
      <Dialog open={created && !!inv} onClose={() => setCreated(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Invoice {inv?.number} created</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{inv?.clientName} · {money(inv?.total)}. What would you like to do next?</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button color="inherit" startIcon={<EditOutlinedIcon />} onClick={() => setCreated(false)}>Edit</Button>
          <Button startIcon={<PictureAsPdfOutlinedIcon />} href={inv ? fileUrl(`/invoices/${inv.id}/pdf`) : '#'} target="_blank" rel="noreferrer">View PDF</Button>
          <Button variant="contained" startIcon={<EmailOutlinedIcon />} disabled={sending} onClick={() => { setCreated(false); sendNow(); }}>Send</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
