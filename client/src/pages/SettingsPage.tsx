import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Tabs, Tab, Grid, TextField, Button, Stack, Typography, MenuItem, Switch, FormControlLabel, Chip, Autocomplete, Alert, IconButton,
  List, ListItem, ListItemText, Divider, ToggleButtonGroup, ToggleButton, Avatar, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import AddToDriveIcon from '@mui/icons-material/AddToDrive';
import EventIcon from '@mui/icons-material/Event';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import { get, patch, post, del } from '../api/client';
import type { Settings, Category, IncomeSource, User, IntegrationStatus } from '../api/types';
import { PageHeader, LoadingBlock, SectionCard, useConfirm } from '../components/common';
import { useAuth } from '../hooks/useAuth';
import { useCategories, useIncomeSources, useClients, useIntegrations } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { useThemeMode, type ThemePref } from '../theme/ThemeModeProvider';
import { fmtDate, localToday } from '../utils/format';
import dayjs from 'dayjs';
import { InstallSettings } from '../components/InstallApp';
import { pushSupported, needsHomeScreen, enablePush, disablePush, currentSubscription } from '../utils/push';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIMEZONES = ['Australia/Adelaide', 'Australia/Darwin', 'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart', 'Australia/Perth', 'Pacific/Auckland', 'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
const CURRENCIES = ['AUD', 'NZD', 'USD', 'GBP', 'EUR', 'NPR', 'INR', 'SGD', 'CAD'];

function useSaver() {
  const toast = useToast();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, keys: string[], msg = 'Saved') => {
    try { await fn(); await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))); toast(msg); } catch (e) { toast((e as Error).message, 'error'); }
  };
}

/** Delete everything and start again. Asks for the password and the word DELETE so it can't happen by accident. */
function ResetEverything() {
  const qc = useQueryClient();
  const toast = useToast();
  const integrations = useIntegrations();
  const googleConnected = !!integrations.data?.googleCalendar.email;
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [pw, setPw] = useState('');
  const [disconnectGoogle, setDisconnectGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (busy) return; setOpen(false); setConfirmText(''); setPw(''); setError(null); setDisconnectGoogle(false); };
  const run = async () => {
    setBusy(true); setError(null);
    try {
      await post('/auth/reset-data', { currentPassword: pw, confirm: confirmText, disconnectGoogle });
      try { localStorage.removeItem('pt-last-employer'); } catch { /* ignore */ }
      setBusy(false); setOpen(false); setConfirmText(''); setPw('');
      qc.clear();
      toast('Everything was deleted. You’re starting fresh.');
      window.location.assign('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <SectionCard title="Reset everything" subtitle="Delete all your data and start again">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Removes every job, shift, income and expense record, bill, invoice, client, task, receipt, document, budget and setting. Your login stays, and the starting categories come back. This can’t be undone.</Typography>
      <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setOpen(true)}>Delete all my data…</Button>
      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>Delete all your data?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="error">This permanently deletes everything in your account. There is no undo and no backup. If you might want the figures later, download them first from <b>Reports → More → Full financial report (Excel)</b>.</Alert>
            <Typography variant="body2" color="text.secondary">Events already added to Google Calendar and files already saved to Google Drive stay in Google; delete them there if you want them gone.</Typography>
            {googleConnected && <FormControlLabel control={<Checkbox checked={disconnectGoogle} onChange={(e) => setDisconnectGoogle(e.target.checked)} />} label="Also disconnect my Google account" />}
            <TextField label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            <TextField type="password" label="Your password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            {error && <Alert severity="warning">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} color="inherit" disabled={busy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={run} disabled={busy || confirmText.trim().toUpperCase() !== 'DELETE' || !pw}>{busy ? 'Deleting…' : 'Delete everything'}</Button>
        </DialogActions>
      </Dialog>
    </SectionCard>
  );
}

function AccountTab() {
  const { user, refresh } = useAuth();
  const { pref, setPref } = useThemeMode();
  const save = useSaver();
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', currency: user?.currency ?? 'AUD', timezone: user?.timezone ?? 'Australia/Adelaide' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <SectionCard title="Profile">
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}><Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.main' }}>{form.name.charAt(0).toUpperCase()}</Avatar><Typography variant="body2" color="text.secondary">Your data is private to this account.</Typography></Stack>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField select label="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><Autocomplete freeSolo options={TIMEZONES} value={form.timezone} onInputChange={(_, v) => setForm({ ...form, timezone: v })} renderInput={(p) => <TextField {...p} label="Timezone" />} /></Grid>
            <Grid size={12}>
              <Typography variant="body2" sx={{ mb: 1 }}>Theme</Typography>
              <ToggleButtonGroup exclusive size="small" value={pref} onChange={(_, v: ThemePref | null) => { if (v) { setPref(v); patch('/auth/me', { theme: v }).catch(() => undefined); } }}>
                <ToggleButton value="light">Light</ToggleButton><ToggleButton value="dark">Dark</ToggleButton><ToggleButton value="system">System</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
          </Grid>
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => save(async () => { await patch<{ user: User }>('/auth/me', form); await refresh(); }, ['me', 'dashboard'])}>Save profile</Button>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <SectionCard title="Change password">
          <Stack spacing={2}>
            <TextField type="password" label="Current password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
            <TextField type="password" label="New password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} helperText="At least 8 characters. Other devices will be signed out." autoComplete="new-password" />
            <Button variant="outlined" disabled={!pw.currentPassword || pw.newPassword.length < 8} onClick={() => save(async () => { await post('/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); }, [], 'Password changed')}>Update password</Button>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }} sx={{ order: 1 }}>
        <ResetEverything />
      </Grid>
      <Grid size={{ xs: 12, md: 7 }}>
        <SectionCard title="Install the app" subtitle="Put Personal Tracker on your Home Screen so it opens full screen like any other app">
          <InstallSettings />
        </SectionCard>
      </Grid>
    </Grid>
  );
}

function LookupEditor({ title, subtitle, endpoint, queryKey, items, renderExtra }: { title: string; subtitle?: string; endpoint: string; queryKey: string; items: (Category | IncomeSource)[]; renderExtra?: (item: any) => React.ReactNode }) {
  const save = useSaver();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  return (
    <SectionCard title={title} subtitle={subtitle}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour" style={{ width: 40, height: 40, border: 'none', background: 'none', padding: 0 }} />
        <TextField label={`New ${title.toLowerCase().replace(/s$/, '')}`} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="outlined" disabled={!name.trim()} onClick={() => save(async () => { await post(endpoint, { name: name.trim(), color }); setName(''); }, [queryKey])}>Add</Button>
      </Stack>
      <List dense disablePadding sx={{ maxHeight: 360, overflow: 'auto' }}>
        {items.map((c) => (
          <ListItem key={c.id} disableGutters secondaryAction={<Stack direction="row">
            <IconButton size="small" aria-label={c.archived ? 'Unarchive' : 'Archive'} onClick={() => save(() => patch(`${endpoint}/${c.id}`, { archived: !c.archived }), [queryKey])}>{c.archived ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />}</IconButton>
            <IconButton size="small" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${c.name}?`, message: 'Only possible if no records use it. Archive it instead to hide it from pickers.', confirmText: 'Delete' })) save(() => del(`${endpoint}/${c.id}`), [queryKey], 'Deleted'); }}><DeleteOutlineIcon fontSize="small" /></IconButton>
          </Stack>}>
            <input type="color" value={c.color} aria-label={`${c.name} colour`} onChange={(e) => save(() => patch(`${endpoint}/${c.id}`, { color: e.target.value }), [queryKey])} style={{ width: 22, height: 22, border: 'none', background: 'none', padding: 0, marginRight: 10 }} />
            <ListItemText primary={c.name} secondary={<>{c.archived ? 'Archived' : null}{renderExtra?.(c)}</>} sx={{ opacity: c.archived ? 0.6 : 1, pr: 10 }} slotProps={{ secondary: { component: 'div' } }} />
          </ListItem>
        ))}
      </List>
    </SectionCard>
  );
}

function FinanceTab({ settings }: { settings: Settings }) {
  const cats = useCategories();
  const srcs = useIncomeSources();
  const clients = useClients();
  const contractors = (clients.data ?? []).filter((c) => c.type === 'contractor');
  const save = useSaver();
  const sourceExtra = (s: IncomeSource) => (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.75 }} onClick={(e) => e.stopPropagation()}>
      <TextField select size="small" label="Default: working as" value={s.workType ?? 'own'} sx={{ minWidth: 170 }} fullWidth={false}
        onChange={(e) => save(() => patch(`/income-sources/${s.id}`, { workType: e.target.value, ...(e.target.value !== 'subcontract' ? { contractorId: null } : {}) }), ['income-sources'])}>
        <MenuItem value="own">Own business</MenuItem>
        <MenuItem value="subcontract">Under a contractor</MenuItem>
        <MenuItem value="employee">Employee (wages)</MenuItem>
      </TextField>
      {s.workType === 'subcontract' && (
        <TextField select size="small" label="Contractor" value={s.contractorId ?? ''} sx={{ minWidth: 170 }} fullWidth={false}
          helperText={!contractors.length ? 'Add a contractor in Clients & contractors' : undefined}
          onChange={(e) => save(() => patch(`/income-sources/${s.id}`, { contractorId: e.target.value || null }), ['income-sources'])}>
          <MenuItem value="">Ask each time</MenuItem>
          {contractors.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
      )}
    </Stack>
  );
  const [methods, setMethods] = useState(settings.paymentMethods);
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}><LookupEditor title="Expense categories" endpoint="/categories" queryKey="categories" items={cats.data ?? []} /></Grid>
      <Grid size={{ xs: 12, md: 6 }}><LookupEditor title="Income sources" subtitle="Set whether jobs from each source are your own business or done under a contractor" endpoint="/income-sources" queryKey="income-sources" items={srcs.data ?? []} renderExtra={sourceExtra} /></Grid>
      <Grid size={12}>
        <SectionCard title="Payment methods">
          <Autocomplete multiple freeSolo options={[]} value={methods} onChange={(_, v) => setMethods(v as string[])} renderInput={(p) => <TextField {...p} label="Payment methods" helperText="Type and press Enter to add" />} />
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => save(() => patch('/settings', { paymentMethods: methods }), ['settings'])}>Save</Button>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

function NotificationsTab({ settings }: { settings: Settings }) {
  const save = useSaver();
  const toast = useToast();
  const [n, setN] = useState({ ...settings.notifications, inAppPopups: settings.notifications.inAppPopups !== false });
  const [busy, setBusy] = useState<string | null>(null);
  const [thisDevice, setThisDevice] = useState(false);
  const status = useQuery({ queryKey: ['notify-status'], queryFn: () => get<{ emailConfigured: boolean; emailVia?: 'gmail' | 'smtp' | null; emailFrom?: string | null; gmailNeedsPermission?: boolean; googleAvailable?: boolean; devices: { id: string; userAgent?: string; addedAt?: string }[] }>('/notifications/status') });
  useEffect(() => { currentSubscription().then((s) => setThisDevice(!!s)).catch(() => undefined); }, []);
  const sw = (k: keyof typeof n, label: string) => <FormControlLabel control={<Switch checked={!!n[k]} onChange={(e) => setN({ ...n, [k]: e.target.checked })} />} label={label} />;
  const persist = (next = n, msg = 'Saved') => save(() => patch('/settings', { notifications: next }), ['settings', 'alerts', 'notify-status'], msg);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { toast(await fn()); await status.refetch(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const deviceName = (ua = '') => (/iphone|ipad/i.test(ua) ? 'iPhone / iPad' : /android/i.test(ua) ? 'Android phone' : /windows/i.test(ua) ? 'Windows computer' : /mac os/i.test(ua) ? 'Mac' : 'Device') + (/edg\//i.test(ua) ? ' · Edge' : /chrome\//i.test(ua) ? ' · Chrome' : /firefox\//i.test(ua) ? ' · Firefox' : /safari\//i.test(ua) ? ' · Safari' : '');
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="What to remind me about" subtitle="These appear under the bell in the app, and in emails and phone notifications if you turn those on">
          <Stack spacing={1}>
            {sw('billReminders', 'Upcoming bills')}
            {n.billReminders && <TextField type="number" label="Remind me this many days before" value={n.billReminderDays} onChange={(e) => setN({ ...n, billReminderDays: Number(e.target.value) })} sx={{ maxWidth: 280 }} />}
            {sw('invoiceReminders', 'Overdue & due-soon invoices')}
            {sw('jobReminders', 'Jobs today & tomorrow')}
            {sw('budgetAlerts', 'Budget, income and savings alerts')}
            {sw('taskReminders', 'High-priority tasks today')}
            <Divider />
            {sw('inAppPopups', 'Show a pop-up in the app when something new comes up')}
          </Stack>
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => persist()}>Save</Button>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={2}>
          <SectionCard title="Daily email summary" subtitle="One email each morning, only on days when there is something to tell you">
            {status.data && !status.data.emailConfigured && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                {status.data.gmailNeedsPermission
                  ? <>Email isn’t set up yet. Go to <b>Integrations</b>, click <b>Reconnect</b> and allow “Send email on your behalf” — emails are then sent from your own Google account.</>
                  : status.data.googleAvailable
                    ? <>Email isn’t set up yet. Connect your Google account under <b>Integrations</b> and emails are sent from it — nothing else to configure.</>
                    : <>Email isn’t set up yet. Connect Google (see <code>docs/GOOGLE_SETUP.md</code>), or add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to <code>.env</code>. Steps: <code>docs/NOTIFICATIONS.md</code>.</>}
              </Alert>
            )}
            {status.data?.emailVia === 'gmail' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Emails are sent from your Google account{status.data.emailFrom ? ` (${status.data.emailFrom})` : ''}.</Typography>}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <FormControlLabel control={<Switch checked={!!n.emailEnabled} onChange={(e) => { const next = { ...n, emailEnabled: e.target.checked }; setN(next); persist(next, e.target.checked ? 'Daily email turned on' : 'Daily email turned off'); }} />} label="Email me a daily summary" />
              <TextField select label="Send at" value={n.emailHour ?? 7} onChange={(e) => { const next = { ...n, emailHour: Number(e.target.value) }; setN(next); persist(next); }} sx={{ maxWidth: 150 }} disabled={!n.emailEnabled}>
                {hours.map((h) => <MenuItem key={h} value={h}>{`${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`}</MenuItem>)}
              </TextField>
            </Stack>
            <Button sx={{ mt: 1 }} disabled={busy === 'email' || !status.data?.emailConfigured} onClick={() => run('email', async () => { const r = await post<{ to: string }>('/notifications/test', { channel: 'email' }); return `Test email sent to ${r.to}`; })}>{busy === 'email' ? 'Sending…' : 'Send a test email'}</Button>
          </SectionCard>
          <SectionCard title="Phone & computer notifications" subtitle="Pop-up reminders between 7am and 9pm, each one sent once">
            {!pushSupported() ? <Alert severity="info">This browser doesn’t support notifications.</Alert> : needsHomeScreen() ? (
              <Alert severity="info">On iPhone, first add this app to your Home Screen: tap <b>Share → Add to Home Screen</b>, open it from the new icon, then come back here.</Alert>
            ) : (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {thisDevice ? (
                    <Button variant="outlined" disabled={busy === 'push'} onClick={() => run('push', async () => { await disablePush(); setThisDevice(false); return 'Notifications turned off for this device'; })}>Turn off for this device</Button>
                  ) : (
                    <Button variant="contained" disabled={busy === 'push'} onClick={() => run('push', async () => { await enablePush(); setThisDevice(true); setN((v) => ({ ...v, pushEnabled: true })); return 'Notifications are on for this device'; })}>{busy === 'push' ? 'Turning on…' : 'Turn on for this device'}</Button>
                  )}
                  <Button disabled={busy === 'ptest' || !status.data?.devices.length} onClick={() => run('ptest', async () => { await post('/notifications/test', { channel: 'push' }); return 'Test notification sent'; })}>Send a test</Button>
                </Stack>
                <FormControlLabel control={<Switch checked={!!n.pushEnabled} onChange={(e) => { const next = { ...n, pushEnabled: e.target.checked }; setN(next); persist(next, e.target.checked ? 'Phone notifications on' : 'Phone notifications paused'); }} />} label="Send notifications to my devices" />
                {(status.data?.devices ?? []).length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Devices receiving notifications</Typography>
                    {status.data!.devices.map((d) => <Typography key={d.id} variant="body2">{deviceName(d.userAgent)}{d.addedAt ? ` · added ${fmtDate(d.addedAt.slice(0, 10))}` : ''}</Typography>)}
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">Turn it on separately on each phone or computer you want reminders on. Reminders are sent while the app’s server is running.</Typography>
              </Stack>
            )}
          </SectionCard>
        </Stack>
      </Grid>
    </Grid>
  );
}

function InvoiceTab({ settings }: { settings: Settings }) {
  const save = useSaver();
  const toast = useToast();
  const [f, setF] = useState(settings.invoice);
  const [preview, setPreview] = useState('');
  useEffect(() => { const t = setTimeout(() => get<{ preview: string }>('/settings/invoice-number-preview', { format: f.numberFormat, seq: f.nextSequence }).then((r) => setPreview(r.preview)).catch(() => setPreview('')), 300); return () => clearTimeout(t); }, [f.numberFormat, f.nextSequence]);
  const t = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => <TextField label={label} value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />;
  const onLogo = (file?: File) => {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) return toast('Logo must be PNG or JPEG', 'error');
    if (file.size > 280_000) return toast('Logo must be under 280 KB', 'error');
    const r = new FileReader();
    r.onload = () => setF({ ...f, logoDataUrl: String(r.result) });
    r.readAsDataURL(file);
  };
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Your business / personal details" subtitle="Shown on invoices">
          <Stack spacing={2}>
            {t('businessName', 'Business or your name')}
            {t('abn', 'ABN')}
            {t('address', 'Address', { multiline: true })}
            {t('email', 'Email')}
            {t('phone', 'Phone')}
            {t('paymentDetails', 'Payment details (BSB, account, PayID)', { multiline: true, minRows: 2 })}
            <Stack direction="row" spacing={2} alignItems="center">
              {f.logoDataUrl && <Box component="img" src={f.logoDataUrl} alt="Logo" sx={{ height: 48, maxWidth: 120, objectFit: 'contain' }} />}
              <Button component="label" variant="outlined">Upload logo<input hidden type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} /></Button>
              {f.logoDataUrl && <Button color="inherit" onClick={() => setF({ ...f, logoDataUrl: '' })}>Remove</Button>}
            </Stack>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Numbering & defaults">
          <Stack spacing={2}>
            {t('numberFormat', 'Invoice number format', { helperText: `Tokens: {YYYY} {YY} {MM} {SEQ} {SEQ:3}. Next: ${preview || '…'}` })}
            <TextField type="number" label="Next sequence number" value={f.nextSequence} onChange={(e) => setF({ ...f, nextSequence: Number(e.target.value) })} />
            <TextField type="number" label="Default payment terms (days)" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: Number(e.target.value) })} />
            {t('defaultNotes', 'Default invoice notes', { multiline: true })}
            <FormControlLabel control={<Switch checked={f.gstRegistered} onChange={(e) => setF({ ...f, gstRegistered: e.target.checked })} />} label="Registered for GST" />
            {f.gstRegistered && <TextField type="number" label="GST rate %" value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: Number(e.target.value) })} />}
          </Stack>
        </SectionCard>
      </Grid>
      <Grid size={12}><Button variant="contained" onClick={() => save(() => patch('/settings', { invoice: f }), ['settings'])}>Save invoice settings</Button></Grid>
    </Grid>
  );
}

const SYNC_TYPES = [
  { value: 'job', label: 'Jobs' }, { value: 'appointment', label: 'Appointments' }, { value: 'event', label: 'Important events' },
  { value: 'task', label: 'Other tasks & reminders' }, { value: 'bill', label: 'Bills (recurring, with reminder)' }, { value: 'invoice', label: 'Invoice due dates' },
];

function IntegrationsTab({ settings }: { settings: Settings }) {
  const status = useIntegrations();
  const qc = useQueryClient();
  const save = useSaver();
  const toast = useToast();
  const confirm = useConfirm();
  const [cal, setCal] = useState(settings.integrations.googleCalendar);
  const [drive, setDrive] = useState(settings.integrations.googleDrive);
  const [busy, setBusy] = useState<string | null>(null);
  const g = status.data?.googleCalendar;
  const d = status.data?.googleDrive;
  const configured = !!g?.configured;
  const account = g?.email;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['integrations'] }), qc.invalidateQueries({ queryKey: ['settings'] })]);

  const connect = async () => {
    try {
      const { url } = await get<{ url: string }>('/integrations/google/auth-url');
      window.location.href = url;
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { toast(await fn()); await refresh(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const saveCal = (next = cal) => save(() => patch('/settings', { integrations: { googleCalendar: next } }), ['settings', 'integrations']);
  const saveDrive = (next = drive) => save(() => patch('/settings', { integrations: { googleDrive: next } }), ['settings', 'integrations']);
  const Status = ({ s }: { s?: IntegrationStatus }) => <Chip size="small" label={s?.connected ? 'Connected' : s?.needsReconnect ? 'Reconnect needed' : 'Not connected'} color={s?.connected ? 'success' : s?.needsReconnect ? 'warning' : 'default'} variant={s?.connected ? 'filled' : 'outlined'} />;

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>Google account</Typography>
              <Typography variant="body2" color="text.secondary">
                {!configured ? 'Google sign-in is not set up on the server yet.' : account ? <>Connected as <b>{account}</b>. One connection is used for Calendar and Drive.</> : 'Connect once to use Google Calendar and Google Drive.'}
              </Typography>
              {g?.lastError && <Typography variant="caption" color={g.needsReconnect ? 'warning.main' : 'text.secondary'} component="div" sx={{ mt: 0.5 }}>Last issue: {g.lastError}</Typography>}
            </Box>
            {configured && (account ? (
              <Stack direction="row" spacing={1}>
                {(g?.needsReconnect || (g?.missingScopes?.length ?? 0) > 0) && <Button variant="contained" onClick={connect}>Reconnect</Button>}
                <Button color="inherit" onClick={async () => { if (await confirm({ title: 'Disconnect Google?', message: 'Syncing stops and access is revoked. Events and files already in your Google account are kept.', confirmText: 'Disconnect' })) run('disc', async () => { await post('/integrations/google/disconnect'); return 'Google disconnected'; }); }}>Disconnect</Button>
              </Stack>
            ) : <Button variant="contained" onClick={connect}>Connect Google</Button>)}
          </Stack>
          {!configured && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <b>One-time setup (about 10 minutes, free):</b> create a Google Cloud project, enable the Google Calendar API and Google Drive API, create an OAuth client (Web application) with redirect URI <code>http://localhost:4000/api/integrations/google/callback</code>, then add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>GOOGLE_REDIRECT_URI</code> to <code>.env</code> and restart. Full steps: <code>docs/GOOGLE_SETUP.md</code>.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ color: 'primary.main', display: 'flex' }}><EventIcon /></Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>Google Calendar</Typography>
            <Status s={g} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{g?.message ?? 'Checking…'}</Typography>
          <Stack sx={{ mt: 1.5 }} spacing={1.5}>
            <FormControlLabel control={<Switch checked={cal.enabled} onChange={(e) => { const next = { ...cal, enabled: e.target.checked }; setCal(next); saveCal(next); }} />} label="Sync to Google Calendar automatically" />
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>What to sync</Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={1}>
                {SYNC_TYPES.map((t) => (
                  <FormControlLabel key={t.value} control={<Checkbox size="small" checked={cal.syncTypes.includes(t.value)} onChange={(e) => setCal({ ...cal, syncTypes: e.target.checked ? [...cal.syncTypes, t.value] : cal.syncTypes.filter((x) => x !== t.value) })} />} label={t.label} />
                ))}
              </Stack>
            </Box>
            <FormControlLabel control={<Switch checked={cal.twoWay !== false} onChange={(e) => { const next = { ...cal, twoWay: e.target.checked }; setCal(next); saveCal(next); }} />} label="Two-way: when I move or retime a job or appointment in Google Calendar, update it here too" />
            <TextField label="Calendar ID" value={cal.calendarId} onChange={(e) => setCal({ ...cal, calendarId: e.target.value })} helperText="'primary' is your main calendar. To use a separate calendar, paste its ID from Google Calendar → Settings → Integrate calendar." sx={{ maxWidth: 520 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" onClick={() => saveCal()}>Save calendar settings</Button>
              <Button variant="contained" disabled={!g?.connected || !cal.enabled || busy === 'sync'} onClick={() => run('sync', async () => {
                await patch('/settings', { integrations: { googleCalendar: cal } });
                const { counts } = await post<{ counts: Record<string, number> }>('/integrations/google/calendar/sync');
                return `Calendar synced: ${counts.created} added, ${counts.updated} updated, ${counts.removed} removed${counts.pulled ? `, ${counts.pulled} change(s) brought in from Google` : ''}${counts.detached ? `, ${counts.detached} unlinked (deleted in Google)` : ''}${counts.error ? `, ${counts.error} failed` : ''}`;
              })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>
              <Button color="inherit" disabled={!g?.connected || busy === 'remove'} onClick={async () => { if (await confirm({ title: 'Remove synced events?', message: 'Deletes every event this app added to your Google Calendar and turns syncing off. Your records here are not changed.', confirmText: 'Remove events' })) run('remove', async () => {
                const next = { ...cal, enabled: false };
                await patch('/settings', { integrations: { googleCalendar: next } }); setCal(next);
                const { counts } = await post<{ counts: Record<string, number> }>('/integrations/google/calendar/sync', { removeAll: true });
                return `${counts.removed} event(s) removed from Google Calendar`;
              }); }}>Remove synced events</Button>
            </Stack>
            {g?.lastCalendarSyncAt && <Typography variant="caption" color="text.secondary">Last full sync: {new Date(g.lastCalendarSyncAt).toLocaleString()}</Typography>}
            <Typography variant="caption" color="text.secondary">Changes sync automatically when you add, edit, cancel or delete records. Each record has exactly one event — edits update it instead of creating duplicates. With two-way on, moving or retiming a job or one-off appointment in Google updates it here within about 10 minutes (or when you open My Day / Calendar). Deleting an event in Google keeps the record here and just stops syncing it. Bills, invoice dates and repeating tasks are controlled from this app.</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ color: 'primary.main', display: 'flex' }}><AddToDriveIcon /></Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>Google Drive</Typography>
            <Status s={d} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{d?.message ?? 'Checking…'} The app can only see files and folders it creates — not the rest of your Drive.</Typography>
          <Stack sx={{ mt: 1.5 }} spacing={1}>
            <FormControlLabel control={<Switch checked={drive.enabled} onChange={(e) => { const next = { ...drive, enabled: e.target.checked }; setDrive(next); saveDrive(next); }} />} label="Use Google Drive for invoices & documents" />
            <FormControlLabel disabled={!drive.enabled} control={<Checkbox checked={drive.autoUploadInvoices !== false} onChange={(e) => setDrive({ ...drive, autoUploadInvoices: e.target.checked })} />} label="Upload invoice PDFs automatically when sent or paid (and update them after edits)" />
            <FormControlLabel disabled={!drive.enabled} control={<Checkbox checked={drive.autoUploadDocuments !== false} onChange={(e) => setDrive({ ...drive, autoUploadDocuments: e.target.checked })} />} label="Upload receipts & documents automatically" />
            <TextField label="Main folder name" value={drive.rootFolderName} onChange={(e) => setDrive({ ...drive, rootFolderName: e.target.value })} helperText="Personal Finance/Invoices/2026/October · Receipts/2026 · Financial Documents" sx={{ maxWidth: 480 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" onClick={() => saveDrive()}>Save Drive settings</Button>
              <Button variant="contained" disabled={!d?.connected || busy === 'folders'} onClick={() => run('folders', async () => { await patch('/settings', { integrations: { googleDrive: drive } }); const r = await post<{ link: string }>('/integrations/google/drive/setup'); window.open(r.link, '_blank'); return 'Folders are ready in Google Drive'; })}>{busy === 'folders' ? 'Creating…' : 'Create folders'}</Button>
              {settings.integrations.googleDrive.rootFolderId && <Button href={`https://drive.google.com/drive/folders/${settings.integrations.googleDrive.rootFolderId}`} target="_blank">Open in Google Drive</Button>}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {(['ocr', 'travel'] as const).map((k) => (
        <Card key={k}>
          <CardContent>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ color: 'primary.main', display: 'flex' }}>{k === 'ocr' ? <DocumentScannerOutlinedIcon /> : <DirectionsCarOutlinedIcon />}</Box>
              <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>{k === 'ocr' ? 'Receipt OCR' : 'Distance & travel time'}</Typography>
              <Status s={status.data?.[k]} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{status.data?.[k]?.message ?? 'Checking…'}</Typography>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function TravelTab({ settings }: { settings: Settings }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [t, setT] = useState(settings.travel);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await patch<Settings & { homeWarning?: string }>('/settings', { travel: { enabled: t.enabled, homeAddress: t.homeAddress, startFrom: t.startFrom, returnHome: t.returnHome, fuelPricePerLitre: Number(t.fuelPricePerLitre) || 0, litresPer100km: Number(t.litresPer100km) || 0, countryCode: t.countryCode || 'au' } });
      setT(r.travel);
      await Promise.all(['settings', 'travel', 'dashboard', 'integrations'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(r.homeWarning ?? 'Travel settings saved', r.homeWarning ? 'warning' : 'success');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const backfill = async () => {
    setBusy(true);
    try {
      const to = localToday();
      const from = dayjs(to).subtract(90, 'day').format('YYYY-MM-DD');
      const r = await post<{ calculated: number; remaining: number }>('/travel/backfill', { from, to: dayjs(to).add(14, 'day').format('YYYY-MM-DD') });
      await Promise.all(['travel', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(`Routes calculated for ${r.calculated} day(s)${r.remaining ? ` — ${r.remaining} more, click again` : ''}`);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const perKm = (Number(t.litresPer100km) / 100) * Number(t.fuelPricePerLitre);
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <SectionCard title="Distance & travel" subtitle="Driving distance and time between your jobs, fuel cost and income per km">
          <Stack spacing={2}>
            <FormControlLabel control={<Switch checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} />} label="Calculate travel for my jobs" />
            <TextField label="Home / start address" value={t.homeAddress} onChange={(e) => setT({ ...t, homeAddress: e.target.value })} placeholder="e.g. 10 King William St, Adelaide SA 5000"
              helperText={t.homeAddress ? (t.homeLat !== undefined ? 'Found on the map ✓' : 'Will be looked up when you save') : 'Optional — without it, each day starts at your first job'} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Each day starts from" value={t.startFrom} onChange={(e) => setT({ ...t, startFrom: e.target.value as 'home' | 'first_job' })}>
                <MenuItem value="home">Home</MenuItem><MenuItem value="first_job">My first job</MenuItem>
              </TextField>
              <FormControlLabel sx={{ minWidth: 220 }} control={<Switch checked={t.returnHome} onChange={(e) => setT({ ...t, returnHome: e.target.checked })} />} label="Include driving home" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField type="number" label="Fuel price ($ per litre)" value={t.fuelPricePerLitre} onChange={(e) => setT({ ...t, fuelPricePerLitre: e.target.value as unknown as number })} slotProps={{ htmlInput: { step: '0.01', min: 0 } }} />
              <TextField type="number" label="Fuel use (litres per 100 km)" value={t.litresPer100km} onChange={(e) => setT({ ...t, litresPer100km: e.target.value as unknown as number })} slotProps={{ htmlInput: { step: '0.1', min: 0 } }} helperText="Small car ≈ 6–7, SUV ≈ 9–11" />
            </Stack>
            <Typography variant="body2" color="text.secondary">Fuel cost works out to about <b>${perKm.toFixed(2)} per km</b> (${(perKm * 10).toFixed(2)} for 10 km).</Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
              <Button variant="outlined" onClick={backfill} disabled={busy || !settings.travel.enabled}>Calculate past 90 days</Button>
            </Stack>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <SectionCard title="How it works">
          <Stack spacing={1}>
            <Typography variant="body2">Each work day's route is <b>home → your jobs in time order → home</b>. It updates automatically when you import, move, cancel or edit jobs.</Typography>
            <Typography variant="body2">Addresses and driving routes come from free OpenStreetMap services (no account or key needed). Each address is looked up once and remembered. Only addresses are sent — no names, amounts or other details.</Typography>
            <Typography variant="body2" color="text.secondary">If a street number isn't on the map, the street is used, so distances are close but not exact. For heavier use you can add a free OpenRouteService key (ORS_API_KEY in .env).</Typography>
          </Stack>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

function AuditTab() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => get<{ items: any[] }>('/audit') });
  return (
    <SectionCard title="Recent changes" subtitle="Every create, edit and delete of financial records is recorded.">
      {q.isLoading ? <LoadingBlock /> : (
        <List dense disablePadding>
          {(q.data?.items ?? []).map((a, i) => (
            <Box key={a.id}>
              {i > 0 && <Divider component="li" />}
              <ListItem disableGutters>
                <ListItemText primary={`${a.action === 'create' ? 'Created' : a.action === 'update' ? 'Updated' : 'Deleted'} ${a.entity}${a.after?.amount !== undefined ? ` · $${a.after.amount}` : a.before?.amount !== undefined ? ` · $${a.before.amount}` : ''}${a.note ? ` — ${a.note}` : ''}`}
                  secondary={`${fmtDate(a.createdAt?.slice(0, 10))} ${new Date(a.createdAt).toLocaleTimeString()}`} />
              </ListItem>
            </Box>
          ))}
        </List>
      )}
    </SectionCard>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState(params.get('tab') ?? 'account');
  const tabParam = params.get('tab');
  useEffect(() => { if (tabParam) setTab(tabParam); }, [tabParam]);
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    const reasons: Record<string, string> = {
      access_denied: 'You cancelled the Google consent screen.', expired_or_invalid_state: 'The sign-in link expired. Please try again.',
      no_refresh_token: 'Google did not return offline access. Remove the app at myaccount.google.com/permissions and connect again.',
      token_exchange_failed: 'Google sign-in failed. Check GOOGLE_CLIENT_ID/SECRET and the redirect URI.',
    };
    if (g === 'connected') toast('Google connected');
    else toast(reasons[params.get('reason') ?? ''] ?? `Google connection failed (${params.get('reason') ?? 'unknown error'})`, 'error');
    qc.invalidateQueries({ queryKey: ['integrations'] });
    setParams({ tab: 'integrations' }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  return (
    <Box>
      <PageHeader title="Settings" />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setParams({ tab: v }, { replace: true }); }} variant="scrollable" allowScrollButtonsMobile sx={{ px: 1 }}>
          <Tab value="account" label="Account" /><Tab value="finance" label="Finance" /><Tab value="notifications" label="Notifications" />
          <Tab value="invoice" label="Invoice" /><Tab value="travel" label="Travel" /><Tab value="integrations" label="Integrations" /><Tab value="audit" label="Audit log" />
        </Tabs>
      </Card>
      {!settings.data ? <LoadingBlock /> : (
        <>
          {tab === 'account' && <AccountTab />}
          {tab === 'finance' && <FinanceTab settings={settings.data} />}
          {tab === 'notifications' && <NotificationsTab settings={settings.data} />}
          {tab === 'invoice' && <InvoiceTab settings={settings.data} />}
          {tab === 'travel' && <TravelTab settings={settings.data} />}
          {tab === 'integrations' && <IntegrationsTab settings={settings.data} />}
          {tab === 'audit' && <AuditTab />}
        </>
      )}
    </Box>
  );
}
