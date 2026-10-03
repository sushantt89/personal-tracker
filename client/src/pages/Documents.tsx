import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Button, Card, CardActionArea, CardContent, Grid, Stack, Typography, TextField, MenuItem, InputAdornment, Chip, IconButton, Menu, ListItemIcon, Divider, Alert, CardMedia,
} from '@mui/material';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddToDriveIcon from '@mui/icons-material/AddToDrive';
import { get, patch, post, del, fileUrl } from '../api/client';
import type { DocumentRec } from '../api/types';
import { PageHeader, EmptyState, LoadingBlock, useConfirm } from '../components/common';
import { EntityFormDialog, type FieldDef } from '../components/EntityForm';
import { ReceiptUploadDialog } from '../components/ReceiptUploadDialog';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import type { ReceiptScan } from '../api/types';
import { money, fmtDate, localToday, titleCase } from '../utils/format';
import { useLookupMaps, useIntegrations } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

const KINDS = ['receipt', 'invoice', 'financial', 'other'] as const;
const metaFields = (kind?: string): FieldDef[] => [
  { name: 'title', label: 'Title', type: 'text', span: 12 },
  { name: 'kind', label: 'Type', type: 'select', options: KINDS.map((k) => ({ value: k, label: titleCase(k) })) },
  { name: 'date', label: 'Date', type: 'date' },
  ...(kind === 'receipt' || kind === undefined ? [
    { name: 'amount', label: 'Total amount', type: 'money' as const },
    { name: 'merchant', label: 'Merchant', type: 'text' as const },
    { name: 'categoryId', label: 'Category', type: 'category' as const },
    { name: 'gst', label: 'GST', type: 'money' as const },
  ] : []),
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function Documents({ kind }: { kind?: 'receipt' }) {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const { catById, categories } = useLookupMaps();
  const integrations = useIntegrations();
  const driveOn = !!integrations.data?.googleDrive.connected;
  const [params, setParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<string>(kind ?? '');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<File | null>(null);
  const [editing, setEditing] = useState<DocumentRec | null>(null);
  const [expenseFor, setExpenseFor] = useState<DocumentRec | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; doc: DocumentRec } | null>(null);
  const list = useQuery({ queryKey: ['documents', filter, q], queryFn: () => get<{ items: DocumentRec[]; ocrAvailable: boolean }>('/documents', { kind: filter, q }) });
  const uploadKind = params.get('upload') === 'invoice' ? 'invoice' : kind ?? 'receipt';

  useEffect(() => {
    if (params.get('upload')) { setTimeout(() => fileRef.current?.click(), 300); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onUploaded = (doc: DocumentRec & { expense?: unknown }) => {
    invalidate();
    if (params.get('upload')) setParams({});
    if (doc.duplicate) toast('This file was already uploaded — showing the existing copy', 'info');
    else toast(doc.expense ? 'Receipt saved and expense created' : 'Uploaded');
  };
  const [expensePrefill, setExpensePrefill] = useState<Partial<ReceiptScan> | null>(null);
  const readExisting = async (d: DocumentRec) => {
    try {
      toast('Reading the receipt…', 'info');
      const r = await post<ReceiptScan>(`/documents/${d.id}/scan`);
      setExpensePrefill(r);
      setExpenseFor(d);
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const items = list.data?.items ?? [];
  const title = kind === 'receipt' ? 'Receipts' : 'Documents';

  return (
    <Box>
      <PageHeader title={title} subtitle={kind === 'receipt' ? 'Upload receipt photos or PDFs and link them to expenses.' : 'Invoices, receipts and financial documents in one place.'}
        actions={<Button variant="contained" startIcon={<CloudUploadOutlinedIcon />} onClick={() => fileRef.current?.click()}>Upload {kind === 'receipt' ? 'receipt' : 'file'}</Button>} />
      <input ref={fileRef} type="file" hidden accept="image/*,.heic,.heif,application/pdf" capture={undefined} onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending(f); e.target.value = ''; }} />
      {list.data?.ocrAvailable && kind === 'receipt' && <Alert severity="info" icon={<AutoFixHighIcon />} sx={{ mb: 2 }}>Upload a photo or PDF and the merchant, date, total and GST are filled in for you. Receipts are read on your own server — nothing is sent to an outside service. You check everything before it's saved.</Alert>}
      <Card sx={{ mb: 2, p: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField placeholder="Search title, merchant, notes…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ maxWidth: { sm: 320 } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
          {!kind && (
            <TextField select label="Type" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ maxWidth: { sm: 200 } }}>
              <MenuItem value="">All</MenuItem>
              {KINDS.map((k) => <MenuItem key={k} value={k}>{titleCase(k)}</MenuItem>)}
            </TextField>
          )}
        </Stack>
      </Card>
      {list.isLoading ? <LoadingBlock rows={3} height={120} /> : !items.length ? (
        <Card><EmptyState title={`No ${title.toLowerCase()} yet`} message="Upload a photo or PDF. Files are stored privately for your account." action={<Button variant="outlined" startIcon={<CloudUploadOutlinedIcon />} onClick={() => fileRef.current?.click()}>Upload</Button>} /></Card>
      ) : (
        <Grid container spacing={2}>
          {items.map((d) => (
            <Grid key={d.id} size={{ xs: 12, sm: 6, md: 4, xl: 3 }}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardActionArea component="a" href={fileUrl(`/documents/${d.id}/file`)} target="_blank" rel="noreferrer">
                  {d.mimeType?.startsWith('image/') ? (
                    <CardMedia component="img" height="140" image={fileUrl(`/documents/${d.id}/file`)} alt={d.title} sx={{ objectFit: 'cover', bgcolor: 'action.hover' }} />
                  ) : (
                    <Box sx={{ height: 140, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}><PictureAsPdfOutlinedIcon sx={{ fontSize: 48, color: 'text.secondary' }} /></Box>
                  )}
                </CardActionArea>
                <CardContent sx={{ flex: 1, pb: '12px !important' }}>
                  <Stack direction="row" alignItems="flex-start" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{d.title}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">{[d.merchant, d.date ? fmtDate(d.date) : fmtDate(d.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}</Typography>
                    </Box>
                    <IconButton size="small" aria-label="Document actions" onClick={(e) => setMenu({ el: e.currentTarget, doc: d })}><MoreVertIcon fontSize="small" /></IconButton>
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={titleCase(d.kind)} variant="outlined" />
                    {d.amount !== undefined && d.amount !== null && <Chip size="small" label={money(d.amount)} />}
                    {d.categoryId && <Chip size="small" label={catById.get(d.categoryId)?.name} variant="outlined" />}
                    {d.sync?.googleDriveLink && <Chip size="small" icon={<AddToDriveIcon />} label="In Drive" component="a" href={d.sync.googleDriveLink} target="_blank" rel="noreferrer" clickable variant="outlined" />}
                    {d.expenseId ? <Chip size="small" color="success" label="Linked to expense" /> : d.kind === 'receipt' && <Chip size="small" color="warning" variant="outlined" label="No expense" onClick={() => setExpenseFor(d)} />}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="open" component="a" href={fileUrl(`/documents/${menu.doc.id}/file`)} target="_blank" onClick={() => setMenu(null)}><ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>Open</MenuItem>,
          <MenuItem key="dl" component="a" href={fileUrl(`/documents/${menu.doc.id}/file`, { download: 1 })} onClick={() => setMenu(null)}><ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>Download</MenuItem>,
          <MenuItem key="edit" onClick={() => { setEditing(menu.doc); setMenu(null); }}><ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>Edit details</MenuItem>,
          driveOn && !menu.doc.sync?.googleDriveFileId && <MenuItem key="drive" onClick={async () => { const d = menu.doc; setMenu(null); try { await post(`/documents/${d.id}/drive`); invalidate(); toast('Saved to Google Drive'); } catch (e) { toast((e as Error).message, 'error'); } }}><ListItemIcon><AddToDriveIcon fontSize="small" /></ListItemIcon>Save to Google Drive</MenuItem>,
          !menu.doc.expenseId && list.data?.ocrAvailable && /image\/(jpeg|png|webp)|application\/pdf/.test(menu.doc.mimeType ?? '') && <MenuItem key="ocr" onClick={() => { const d = menu.doc; setMenu(null); readExisting(d); }}><ListItemIcon><AutoFixHighIcon fontSize="small" /></ListItemIcon>Read receipt & create expense</MenuItem>,
          !menu.doc.expenseId && <MenuItem key="exp" onClick={() => { setExpenseFor(menu.doc); setMenu(null); }}><ListItemIcon><AddShoppingCartIcon fontSize="small" /></ListItemIcon>Create expense</MenuItem>,
          <Divider key="d" />,
          <MenuItem key="del" sx={{ color: 'error.main' }} onClick={async () => { const d = menu.doc; setMenu(null); if (await confirm({ title: 'Delete this file?', message: 'The file is removed from this app permanently. Linked expenses, and any copy in Google Drive, are kept.', confirmText: 'Delete' })) { await del(`/documents/${d.id}`); invalidate(); toast('Deleted'); } }}><ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>Delete</MenuItem>,
        ]}
      </Menu>

      <ReceiptUploadDialog file={pending} defaultKind={uploadKind} onClose={() => setPending(null)} onSaved={onUploaded} />
      <EntityFormDialog open={!!editing} title="Edit document" fields={metaFields(editing?.kind)} initial={editing ?? {}} onClose={() => setEditing(null)}
        onSubmit={async (v) => { await patch(`/documents/${editing!.id}`, v); invalidate(); toast('Saved'); }} />
      <EntityFormDialog open={!!expenseFor} title="Create expense from receipt" submitLabel="Create expense"
        fields={[
          { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'merchant', label: 'Merchant', type: 'text' }, { name: 'categoryId', label: 'Category', type: 'category' },
          { name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod' },
        ]}
        initial={{
          amount: expenseFor?.amount ?? expensePrefill?.total ?? '', date: expenseFor?.date ?? expensePrefill?.date ?? localToday(), merchant: expenseFor?.merchant ?? expensePrefill?.merchant ?? '',
          categoryId: expenseFor?.categoryId ?? categories.find((c) => c.name.toLowerCase() === expensePrefill?.categoryHint?.toLowerCase())?.id ?? '',
          paymentMethod: expensePrefill?.paymentMethod ?? 'Card', gst: expenseFor?.gst ?? expensePrefill?.gst ?? '',
        }}
        onClose={() => { setExpenseFor(null); setExpensePrefill(null); }}
        onSubmit={async (v) => { await post(`/documents/${expenseFor!.id}/create-expense`, { ...v, gst: v.gst ?? undefined }); invalidate(); toast('Expense created and linked'); }} />
    </Box>
  );
}
