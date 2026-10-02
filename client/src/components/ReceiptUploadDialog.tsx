import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid, Box, Stack, Typography, Alert, Chip, LinearProgress, FormControlLabel, Checkbox,
  Collapse, IconButton, useMediaQuery, useTheme, Table, TableBody, TableRow, TableCell,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { api } from '../api/client';
import type { ReceiptScan, DocumentRec } from '../api/types';
import { FieldGrid, toPayload, type FieldDef, type Values } from './EntityForm';
import { useCategories } from '../hooks/useLookups';
import { money, localToday, titleCase } from '../utils/format';

const KINDS = ['receipt', 'invoice', 'financial', 'other'];
const SCANNABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const isHeicFile = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

/**
 * Upload flow: pick a file → it's read on your own server (OCR) → you check/edit the suggested
 * details → Upload saves the file and (optionally) the expense in one step. Nothing is saved before that.
 */
export function ReceiptUploadDialog({ file, defaultKind, onClose, onSaved }: {
  file: File | null; defaultKind: string; onClose: () => void; onSaved: (doc: DocumentRec & { expense?: unknown }) => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const cats = useCategories();
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [createExpense, setCreateExpense] = useState(true);
  const [showText, setShowText] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (file && file.type.startsWith('image/') && !isHeicFile(file) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!file) return;
    setScan(null); setScanError(null); setError(null); setShowText(false);
    setValues({ title: file.name.replace(/\.[^.]+$/, ''), kind: defaultKind, date: localToday(), paymentMethod: 'Card' });
    setCreateExpense(defaultKind === 'receipt');
    if (!SCANNABLE.includes(file.type) && !isHeicFile(file)) return;
    let cancelled = false;
    (async () => {
      setScanning(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await api<ReceiptScan>('/documents/scan', { method: 'POST', form: fd });
        if (cancelled) return;
        setScan(r);
        const cat = cats.data?.find((c) => c.name.toLowerCase() === r.categoryHint?.toLowerCase());
        setValues((v) => ({
          ...v,
          title: r.merchant ? `${r.merchant}${r.date ? ' ' + r.date : ''}` : v.title,
          date: r.date ?? v.date, amount: r.total ?? '', merchant: r.merchant ?? '', gst: r.gst ?? '',
          categoryId: cat?.id ?? v.categoryId ?? '', paymentMethod: r.paymentMethod ?? v.paymentMethod,
        }));
        if (r.total === undefined) setCreateExpense(false);
      } catch (e) {
        if (!cancelled) setScanError((e as Error).message);
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const isReceipt = values.kind === 'receipt';
  const fields: FieldDef[] = [
    { name: 'title', label: 'Title', type: 'text', span: 12 },
    { name: 'kind', label: 'Type', type: 'select', options: KINDS.map((k) => ({ value: k, label: titleCase(k) })) },
    { name: 'date', label: 'Date', type: 'date', required: createExpense },
    { name: 'amount', label: 'Total amount', type: 'money', required: createExpense },
    { name: 'merchant', label: 'Merchant', type: 'text' },
    { name: 'categoryId', label: 'Category', type: 'category' },
    { name: 'gst', label: 'GST', type: 'money' },
    ...(createExpense ? [{ name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod' as const }] : []),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const submit = async () => {
    setError(null);
    const v = toPayload(fields, values);
    if (createExpense && (!v.date || !v.amount)) return setError('Enter the date and total to create an expense.');
    setSaving(true);
    try {
      const meta: Values = { kind: v.kind, title: v.title, date: v.date || undefined, amount: v.amount ?? undefined, merchant: v.merchant || undefined, categoryId: v.categoryId || null, gst: v.gst ?? undefined, notes: v.notes || undefined };
      if (createExpense) meta.createExpense = { date: v.date, amount: v.amount, merchant: v.merchant || undefined, categoryId: v.categoryId || null, paymentMethod: v.paymentMethod || undefined, gst: v.gst ?? undefined, notes: v.notes || undefined };
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('meta', JSON.stringify(meta));
      onSaved(await api<DocumentRec & { expense?: unknown }>('/documents', { method: 'POST', form: fd }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!file} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Upload {file?.name}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', minHeight: 160, display: 'grid', placeItems: 'center' }}>
              {preview ? <Box component="img" src={preview} alt="Receipt preview" sx={{ width: '100%', maxHeight: 420, objectFit: 'contain' }} /> : file && isHeicFile(file) ? <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>iPhone photo (HEIC)<br />It will be saved as a JPG.</Typography> : <PictureAsPdfOutlinedIcon sx={{ fontSize: 56, color: 'text.secondary' }} />}
            </Box>
            {scan && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                <Chip size="small" icon={<AutoFixHighIcon />} label={scan.source === 'pdf-text' ? 'Read from PDF text' : `${scan.source === 'pdf-scan' ? 'Scanned PDF read by OCR' : 'Read by OCR'} · ${scan.confidence}% clear`} color={scan.source === 'pdf-text' || scan.confidence >= 75 ? 'success' : scan.confidence >= 55 ? 'warning' : 'error'} variant="outlined" />
                {scan.abn && <Chip size="small" label={`ABN ${scan.abn}`} variant="outlined" />}
              </Stack>
            )}
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            {scanning && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>Reading the receipt on your server…</Typography>
                <LinearProgress />
              </Box>
            )}
            {scanError && <Alert severity="info" sx={{ mb: 2 }}>Couldn’t read this file automatically ({scanError}). Fill in the details below.</Alert>}
            {scan && !scanning && (
              <Alert severity={scan.warnings.length ? 'warning' : 'success'} sx={{ mb: 2 }}>
                {scan.warnings.length ? scan.warnings.join(' ') : 'Details filled in from the receipt. Please check them before saving.'}
              </Alert>
            )}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <FieldGrid fields={fields} values={values} setValues={setValues} />
            <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={createExpense} onChange={(e) => setCreateExpense(e.target.checked)} />} label={isReceipt ? 'Also create an expense from this receipt' : 'Also create an expense'} />
            {scan && scan.items.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Items found</Typography>
                <Table size="small"><TableBody>
                  {scan.items.slice(0, 12).map((it, i) => <TableRow key={i}><TableCell sx={{ pl: 0 }}>{it.description}</TableCell><TableCell align="right">{money(it.amount)}</TableCell></TableRow>)}
                </TableBody></Table>
              </Box>
            )}
            {scan?.rawText && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" onClick={() => setShowText((s) => !s)}>{showText ? 'Hide' : 'Show'} text read from the receipt</Button>
                <Collapse in={showText}>
                  <Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1, maxHeight: 220, overflow: 'auto' }}>{scan.rawText}</Typography>
                </Collapse>
              </Box>
            )}
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || scanning}>{saving ? 'Saving…' : createExpense ? 'Upload & save expense' : 'Upload'}</Button>
      </DialogActions>
    </Dialog>
  );
}
