import { useEffect, useState, type ReactNode } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Grid, FormControlLabel, Switch, Alert, Autocomplete,
  InputAdornment, useMediaQuery, useTheme, IconButton, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useCategories, useIncomeSources, useClients, useSettings } from '../hooks/useLookups';
import ReceiptField from './ReceiptField';

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'select' | 'category' | 'source' | 'client' | 'contractor' | 'paymentMethod' | 'switch' | 'tags' | 'heading' | 'receipt';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  span?: number; // grid columns on sm+ (of 12)
  helper?: string;
  quick?: boolean;
  showIf?: (v: Values) => boolean;
  min?: number;
  autoFocus?: boolean;
  /** For type 'client': limit choices to clients or contractors */
  clientType?: 'client' | 'contractor';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Values = Record<string, any>;

export const getPath = (o: Values, path: string) => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Values)[k] : undefined), o);
export function setPath(o: Values, path: string, v: unknown): Values {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...o, [head]: v };
  return { ...o, [head]: setPath((o[head] as Values) ?? {}, rest.join('.'), v) };
}

/** Converts form values into an API payload: numbers parsed, empty strings removed (or nulled for refs). */
export function toPayload(fields: FieldDef[], values: Values): Values {
  let out: Values = { ...values };
  for (const f of fields) {
    if (f.type === 'heading') continue;
    const v = getPath(values, f.name);
    if (f.type === 'number' || f.type === 'money') out = setPath(out, f.name, v === '' || v === undefined || v === null ? null : Number(v));
    else if (['category', 'source', 'client', 'receipt'].includes(f.type)) out = setPath(out, f.name, v || null);
    else if (typeof v === 'string') out = setPath(out, f.name, v.trim());
  }
  return out;
}

export function FieldInput({ f, values, onChange, error }: { f: FieldDef; values: Values; onChange: (name: string, v: unknown) => void; error?: string }) {
  const cats = useCategories();
  const srcs = useIncomeSources();
  const clients = useClients();
  const settings = useSettings();
  const v = getPath(values, f.name);
  const common = { label: f.label, required: f.required, helperText: error ?? f.helper, error: !!error, autoFocus: f.autoFocus };

  switch (f.type) {
    case 'heading':
      return <Typography variant="overline" color="text.secondary">{f.label}</Typography>;
    case 'receipt':
      return <ReceiptField label={f.label} helper={f.helper} value={(v as string) || null} onChange={(id) => onChange(f.name, id)}
        title={`Parking – ${values.clientName || 'job'}${values.date ? ` ${values.date}` : ''}`} date={values.date} />;
    case 'switch':
      return <FormControlLabel control={<Switch checked={!!v} onChange={(e) => onChange(f.name, e.target.checked)} />} label={f.label} />;
    case 'textarea':
      return <TextField {...common} multiline minRows={2} value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)} />;
    case 'money':
      return (
        <TextField {...common} type="number" value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { step: '0.01', min: 0, inputMode: 'decimal' } }} />
      );
    case 'number':
      return <TextField {...common} type="number" value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)} slotProps={{ htmlInput: { min: f.min ?? 0, step: 'any', inputMode: 'decimal' } }} />;
    case 'date':
    case 'time':
      return <TextField {...common} type={f.type} value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />;
    case 'select':
      return (
        <TextField {...common} select value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)}>
          {(f.options ?? []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
      );
    case 'category':
    case 'source': {
      const items = (f.type === 'category' ? cats.data : srcs.data)?.filter((x) => !x.archived || x.id === v) ?? [];
      return (
        <TextField {...common} select value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)}>
          <MenuItem value=""><em>None</em></MenuItem>
          {items.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c.color, marginRight: 8 }} />
              {c.name}
            </MenuItem>
          ))}
        </TextField>
      );
    }
    case 'contractor': {
      // One of the contractors already set up (or none)
      const opts = (clients.data ?? []).filter((c) => c.type === 'contractor');
      return (
        <TextField {...common} select value={opts.some((c) => c.id === v) ? v : ''} onChange={(e) => onChange(f.name, e.target.value)}>
          <MenuItem value=""><em>None</em></MenuItem>
          {opts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
      );
    }
    case 'paymentMethod': {
      const opts = settings.data?.paymentMethods ?? ['Card', 'Cash', 'Bank transfer'];
      return (
        <Autocomplete freeSolo options={opts} value={(v as string) ?? ''} onInputChange={(_, val) => onChange(f.name, val)}
          renderInput={(p) => <TextField {...p} {...common} />} />
      );
    }
    case 'client': {
      // Picks an existing client or types a new name (stored as clientName; server links/creates)
      const nameField = f.name.replace(/Id$/, 'Name');
      const opts = (clients.data ?? []).filter((c) => !f.clientType || (c.type ?? 'client') === f.clientType);
      const current = opts.find((c) => c.id === v);
      return (
        <Autocomplete freeSolo options={opts} getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
          value={current ?? ((getPath(values, nameField) as string) || '')}
          onChange={(_, val) => {
            if (val && typeof val === 'object') { onChange(f.name, val.id); onChange(nameField, val.name); }
            else { onChange(f.name, ''); onChange(nameField, val ?? ''); }
          }}
          onInputChange={(_, val, reason) => { if (reason === 'input') { onChange(f.name, ''); onChange(nameField, val); } }}
          renderInput={(p) => <TextField {...p} {...common} />} />
      );
    }
    case 'tags':
      return (
        <Autocomplete multiple freeSolo options={[]} value={(v as string[]) ?? []} onChange={(_, val) => onChange(f.name, val)}
          slotProps={{ chip: { size: 'small' } }}
          renderInput={(p) => <TextField {...p} label={f.label} helperText={f.helper ?? 'Type and press Enter'} />} />
      );
    default:
      return <TextField {...common} value={v ?? ''} onChange={(e) => onChange(f.name, e.target.value)} />;
  }
}

export function FieldGrid({ fields, values, setValues }: { fields: FieldDef[]; values: Values; setValues: (fn: (v: Values) => Values) => void }) {
  return (
    <Grid container spacing={2}>
      {fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => (
        <Grid key={f.name} size={{ xs: 12, sm: f.span ?? (f.type === 'textarea' || f.type === 'tags' || f.type === 'heading' ? 12 : 6) }}>
          <FieldInput f={f} values={values} onChange={(name, val) => setValues((prev) => setPath(prev, name, val))} />
        </Grid>
      ))}
    </Grid>
  );
}

export function EntityFormDialog({ open, title, fields, initial, onSubmit, onClose, submitLabel = 'Save', extra, derive }: {
  open: boolean; title: string; fields: FieldDef[]; initial: Values; onSubmit: (v: Values) => Promise<unknown>; onClose: () => void; submitLabel?: string; extra?: ReactNode;
  /** Fills in fields that follow from others (e.g. pay = rate × hours) each time something changes */
  derive?: (next: Values, prev: Values) => Values;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [values, setRaw] = useState<Values>(initial);
  const setValues = (fn: Values | ((v: Values) => Values)) => setRaw((prev) => { const next = typeof fn === 'function' ? fn(prev) : fn; return derive ? derive(next, prev) : next; });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setRaw(initial); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = fields.filter((f) => f.required && (!f.showIf || f.showIf(values)) && (getPath(values, f.name) === '' || getPath(values, f.name) === undefined || getPath(values, f.name) === null));
    if (missing.length) return setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}`);
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toPayload(fields, values));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="md" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle sx={{ pr: 6 }}>
          {title}
          <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <FieldGrid fields={fields} values={values} setValues={setValues} />
          {extra}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
