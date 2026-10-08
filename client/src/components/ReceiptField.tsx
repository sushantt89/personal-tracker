import { useRef, useState } from 'react';
import { Box, Button, Stack, Typography, Link, IconButton, Tooltip } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CameraButton from './CameraButton';
import { api, fileUrl } from '../api/client';

/**
 * Attach a receipt (photo or PDF) to a form. The file is saved to Receipts straight away and the field holds its id.
 * Removing it here only unlinks it — the receipt stays in Receipts.
 */
export default function ReceiptField({ label, value, onChange, title, date, helper }: {
  label: string; value?: string | null; onChange: (id: string | null) => void; title?: string; date?: string; helper?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const upload = async (file: File) => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('meta', JSON.stringify({ kind: 'receipt', title: title || file.name, ...(date ? { date } : {}) }));
      const doc = await api<{ id: string; title: string }>('/documents', { method: 'POST', form: fd });
      setName(file.name);
      onChange(doc.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{label}</Typography>
      {value ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <ReceiptLongOutlinedIcon fontSize="small" color="success" />
          <Link href={fileUrl(`/documents/${value}/file`)} target="_blank" rel="noreferrer" variant="body2">{name || 'Receipt attached'} — view</Link>
          <Tooltip title="Remove from this job (it stays in Receipts)"><IconButton size="small" aria-label="Remove receipt" onClick={() => { setName(''); onChange(null); }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" variant="outlined" startIcon={<AttachFileIcon />} disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : 'Attach receipt'}</Button>
          <CameraButton size="small" label="Photo" onPhoto={upload} disabled={busy} />
          <input ref={ref} type="file" hidden accept="image/*,.heic,.heif,application/pdf" aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </Stack>
      )}
      {(error || helper) && <Typography variant="caption" color={error ? 'error' : 'text.secondary'} component="div" sx={{ mt: 0.5 }}>{error || helper}</Typography>}
    </Box>
  );
}
