import CameraButton from '../components/CameraButton';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, InputAdornment, Button, Stack, Typography, Chip, Alert, Grid, IconButton, Tooltip, FormControlLabel, Switch, Checkbox, MenuItem, Divider, LinearProgress, Collapse, ToggleButtonGroup, ToggleButton, Autocomplete,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import { post, api } from '../api/client';
import type { ParseResponse, ParsedJob } from '../api/types';
import { PageHeader } from '../components/common';
import { FieldGrid, type FieldDef, type Values } from '../components/EntityForm';
import { useIncomeSources, useClients, useIntegrations, useSettings } from '../hooks/useLookups';
import type { WorkType } from '../api/types';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import { money, fmtDate, mapsUrl, localToday } from '../utils/format';

const EXAMPLE = `Hi SUSHANT
Your schedule for Friday 2 OCT.
Meet at Goodwood Road McDonald's at 8:45am.
Sonia 8:45am ($25)
25 Angus Street
Goodwood, SA, Australia
Andrew Dana - 10am ($30)
2 Chessington Avenue
Frewville, SA, Australia
Bron B - 11:30am ($30)
25 Clifton St Hawthorn 5062
Kitchen, 2 bathrooms, 3 rooms.
Dusting and wipedown surfaces, vacuum and mop floor.
Change the bed in master bedroom.`;

const jobFields: FieldDef[] = [
  { name: 'clientName', label: 'Client / employer', type: 'text', required: true, span: 6 },
  { name: 'amount', label: 'Amount', type: 'money', span: 6 },
  { name: 'date', label: 'Date', type: 'date', required: true, span: 4 },
  { name: 'startTime', label: 'Start', type: 'time', span: 4 },
  { name: 'endTime', label: 'End', type: 'time', span: 4 },
  { name: 'hoursWorked', label: 'Paid hours', type: 'number', span: 4, helper: 'Leave empty to work it out from the times' },
  { name: 'address.line1', label: 'Street address', type: 'text', span: 12 },
  { name: 'address.suburb', label: 'Suburb', type: 'text', span: 5 },
  { name: 'address.state', label: 'State', type: 'text', span: 3 },
  { name: 'address.postcode', label: 'Postcode', type: 'text', span: 4 },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'tasks', label: 'Tasks', type: 'tags' },
  { name: 'rooms', label: 'Rooms', type: 'number', span: 6 },
  { name: 'bathrooms', label: 'Bathrooms', type: 'number', span: 6 },
  { name: 'specialInstructions', label: 'Special instructions', type: 'textarea' },
];

interface EditJob extends Values { tempId: string; include: boolean; parsed?: ParsedJob }
interface EditPayment extends Values { tempId: string; include: boolean; amount: number; date: string; payer?: string; reference?: string; description: string; matchIncomeId?: string }

export default function PasteImport() {
  const nav = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateFinance();
  const sources = useIncomeSources();
  const clients = useClients();
  const integrations = useIntegrations();
  const settingsQ = useSettings();
  const calSettings = settingsQ.data?.integrations.googleCalendar;
  const calendarAvailable = !!integrations.data?.googleCalendar.connected && !!calSettings?.enabled && !!calSettings.syncTypes.includes('job');
  const [syncCalendar, setSyncCalendar] = useState(true);
  const contractors = (clients.data ?? []).filter((c) => c.type === 'contractor');
  const [workType, setWorkType] = useState<WorkType>('own');
  const [contractor, setContractor] = useState<{ id?: string; name: string }>({ name: '' });
  const applySourceDefaults = (id: string) => {
    const src = sources.data?.find((s) => s.id === id);
    setWorkType(src?.workType ?? 'own');
    const c = contractors.find((x) => x.id === src?.contractorId);
    setContractor(c ? { id: c.id, name: c.name } : { name: '' });
  };
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [jobs, setJobs] = useState<EditJob[]>([]);
  const [payments, setPayments] = useState<EditPayment[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [createIncome, setCreateIncome] = useState(true);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ jobs: number; income: number; updated: number; calendar?: boolean } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [employer, setEmployer] = useState(() => { try { return localStorage.getItem('pt-last-employer') ?? ''; } catch { return ''; } });
  const isRoster = result?.format === 'roster';
  // Rosters don't show pay: an optional expected hourly rate fills each shift with an estimate (hours × rate)
  const [rate, setRate] = useState(() => { try { return localStorage.getItem('pt-expected-rate') ?? ''; } catch { return ''; } });
  const applyRate = (r: string, list?: EditJob[]) => {
    const n = Number(r);
    const fill = (js: EditJob[]) => js.map((j) => ({ ...j, amount: n > 0 && Number(j.hoursWorked) > 0 ? Math.round(Number(j.hoursWorked) * n * 100) / 100 : '' }) as EditJob);
    if (list) return fill(list);
    setRate(r);
    setJobs(fill);
    try { if (n > 0) localStorage.setItem('pt-expected-rate', r); } catch { /* private mode */ }
    return [];
  };

  const show = (r: ParseResponse) => {
      setResult(r);
      // Shifts that are already in the app are left unticked, so re-uploading an updated roster only adds what's new
      const mapped = r.jobs.map((j) => ({ tempId: j.tempId, include: !(r.format === 'roster' && j.duplicateOfJobId), parsed: j, hoursWorked: j.hours ?? '', clientName: j.clientName, amount: j.amount ?? '', date: j.date ?? '', startTime: j.startTime ?? '', endTime: j.endTime ?? '', address: { ...j.address }, description: j.description ?? '', tasks: j.tasks, rooms: j.rooms ?? '', bathrooms: j.bathrooms ?? '', specialInstructions: j.specialInstructions ?? '', meetingPoint: j.meetingPoint })) as EditJob[];
      setJobs(r.format === 'roster' && Number(rate) > 0 ? applyRate(rate, mapped) : mapped);
      setPayments(r.payments.map((p) => ({ ...p, include: true, date: p.date ?? localToday(), matchIncomeId: r.paymentMatches[p.tempId]?.find((m) => m.incomeId)?.incomeId ?? '' })));
      setSourceId(r.suggestedIncomeSourceId ?? '');
      setWorkType(r.suggestedWorkType ?? 'own');
      const sc = contractors.find((x) => x.id === r.suggestedContractorId);
      setContractor(sc ? { id: sc.id, name: sc.name } : { name: '' });
      setAllowDuplicates(false);
  };

  const analyse = async () => {
    setParsing(true); setError(null); setDone(null);
    try {
      show(await post<ParseResponse>('/import/parse', { text, employer: employer.trim() || undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  /** Roster screenshot or photo: the server reads the text out of it, then it is reviewed exactly like pasted text. */
  const uploadRoster = async (file: File) => {
    setReading(true); setError(null); setDone(null); setResult(null); setJobs([]); setPayments([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (employer.trim()) fd.append('employer', employer.trim());
      const r = await api<ParseResponse>('/import/roster', { method: 'POST', form: fd });
      setText(r.text ?? '');
      show(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /** Employer chosen for a roster: name every shift, remember it for next time and re-check for shifts already imported. */
  const applyEmployer = async (name: string) => {
    const clean = name.trim();
    setEmployer(name);
    setJobs((js) => js.map((j) => ({ ...j, clientName: clean })));
    if (!clean) return;
    try { localStorage.setItem('pt-last-employer', clean); } catch { /* private mode */ }
    try {
      const r = await post<ParseResponse>('/import/parse', { text, employer: clean });
      const dup = new Map(r.jobs.map((j) => [j.tempId, j.duplicateOfJobId ?? null]));
      setJobs((js) => js.map((j) => (j.parsed && dup.has(j.tempId) ? { ...j, include: !dup.get(j.tempId), parsed: { ...j.parsed, duplicateOfJobId: dup.get(j.tempId), warnings: j.parsed.warnings.filter((w) => !/employer/i.test(w)) } } : j)));
    } catch { /* the duplicate check also runs when importing */ }
  };

  const pasteFromClipboard = async () => {
    try { setText(await navigator.clipboard.readText()); } catch { toast('Clipboard access was blocked — paste with Ctrl/Cmd+V instead', 'warning'); }
  };

  const included = jobs.filter((j) => j.include);
  const includedPayments = payments.filter((p) => p.include);
  const total = included.reduce((a, j) => a + (Number(j.amount) || 0), 0);
  const totalHours = included.reduce((a, j) => a + (Number(j.hoursWorked) || 0), 0);
  const skippedDups = jobs.filter((j) => !j.include && j.parsed?.duplicateOfJobId).length;
  const invalid = included.filter((j) => !j.clientName?.trim() || !j.date);
  const dupCount = included.filter((j) => j.parsed?.duplicateOfJobId).length;

  const doImport = async () => {
    setImporting(true); setError(null);
    try {
      const num = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : Number(v));
      const body = {
        sourceMessage: text,
        incomeSourceId: sourceId || null,
        workType,
        contractorId: workType === 'subcontract' ? contractor.id ?? null : null,
        contractorName: workType === 'subcontract' && !contractor.id ? contractor.name.trim() || undefined : undefined,
        createIncome,
        syncCalendar: calendarAvailable && syncCalendar,
        allowDuplicates,
        jobs: included.map((j) => ({
          clientName: j.clientName.trim(), date: j.date, startTime: j.startTime || undefined, endTime: j.endTime || undefined, amount: num(j.amount), amountEstimated: isRoster && Number(j.amount) > 0, hoursWorked: num(j.hoursWorked),
          address: j.address, description: j.description || undefined, tasks: j.tasks, rooms: num(j.rooms), bathrooms: num(j.bathrooms),
          specialInstructions: j.specialInstructions || undefined, meetingPoint: j.meetingPoint || undefined,
        })),
        payments: includedPayments.map((p) => ({ amount: Number(p.amount), date: p.date, payer: p.payer || undefined, reference: p.reference || undefined, description: p.description, matchIncomeId: p.matchIncomeId || null })),
      };
      const r = await post<{ jobs: unknown[]; incomeCreated: number; incomeUpdated: number; calendarSync?: string }>('/import/commit', body);
      setDone({ jobs: r.jobs.length, income: r.incomeCreated, updated: r.incomeUpdated, calendar: r.calendarSync === 'queued' });
      setResult(null); setJobs([]); setPayments([]); setText('');
      invalidate();
      toast('Imported successfully');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const updateJob = (id: string, fn: (v: Values) => Values) => setJobs((js) => js.map((j) => (j.tempId === id ? ({ ...j, ...fn(j) } as EditJob) : j)));

  return (
    <Box>
      <PageHeader title="Paste & Import" subtitle="Paste a work schedule or payment message, or upload a photo of your roster. Nothing is saved until you review it and click Import." />

      {done && (
        <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }} action={<Stack direction="row" spacing={1}><Button color="inherit" size="small" onClick={() => nav('/my-day')}>My Day</Button><Button color="inherit" size="small" onClick={() => nav('/jobs')}>Jobs</Button></Stack>}>
          Created {done.jobs} job(s)/shift(s){done.income ? ` and ${done.income} income record(s)` : ''}{done.updated ? `, marked ${done.updated} income record(s) paid` : ''}{done.calendar ? ' and added them to Google Calendar' : ''}. Your dashboard is updated.
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <TextField multiline minRows={6} maxRows={18} placeholder="Paste your message here…" value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Message to import', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 } } }} />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<AutoFixHighIcon />} onClick={analyse} disabled={!text.trim() || parsing}>{parsing ? 'Analysing…' : 'Analyse'}</Button>
            <Button variant="outlined" startIcon={<AddPhotoAlternateOutlinedIcon />} onClick={() => fileRef.current?.click()} disabled={reading || parsing}>{reading ? 'Reading roster…' : 'Upload roster photo'}</Button>
            <input ref={fileRef} type="file" hidden accept="image/*,.heic,.heif,application/pdf" aria-label="Roster screenshot or photo" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRoster(f); }} />
            <CameraButton label="Photograph roster" onPhoto={uploadRoster} disabled={reading || parsing} />
            <Button startIcon={<ContentPasteIcon />} onClick={pasteFromClipboard}>Paste from clipboard</Button>
            <Button onClick={() => setText(EXAMPLE)} color="inherit">Try an example</Button>
            {text && <Button color="inherit" onClick={() => { setText(''); setResult(null); setJobs([]); setPayments([]); }}>Clear</Button>}
          </Stack>
          {(parsing || reading) && <LinearProgress sx={{ mt: 2 }} />}
          {reading && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>Reading the text in your image. This can take up to half a minute.</Typography>}
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {result && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {result.kind === 'unknown' ? 'Nothing detected' : [result.summary.jobCount && `${result.summary.jobCount} ${isRoster ? 'shift' : 'job'}${result.summary.jobCount === 1 ? '' : 's'} detected`, result.summary.paymentCount && `${result.summary.paymentCount} payment${result.summary.paymentCount === 1 ? '' : 's'} detected`].filter(Boolean).join(' · ')}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Found ${result.summary.jobCount} ${isRoster ? 'shifts' : 'jobs'}`} />
                {isRoster ? <Chip label={`${totalHours.toFixed(1)} hours`} color="success" variant="outlined" /> : <Chip label={`Found ${money(result.summary.totalAmount)} total income`} color="success" variant="outlined" />}
                <Chip label={`Found ${result.summary.addressCount} addresses`} />
                <Chip label={`Found ${result.summary.dateCount} date${result.summary.dateCount === 1 ? '' : 's'}${result.summary.dates.length ? ': ' + result.summary.dates.map((d) => fmtDate(d, 'ddd D MMM')).join(', ') : ''}`} />
                {result.meetingPoint && <Chip icon={<PlaceOutlinedIcon />} label={`Meet: ${result.meetingPoint}${result.meetingTime ? ' @ ' + result.meetingTime : ''}`} variant="outlined" />}
              </Stack>
              {result.warnings.map((w) => <Alert key={w} severity="info" sx={{ mt: 1.5 }}>{w}</Alert>)}
              {isRoster && <Alert severity="info" sx={{ mt: 1.5 }}>Rosters don’t show pay. Add an expected hourly rate below if you’d like your forecasts to count these shifts; when you’ve been paid, open <b>Jobs → Record pay</b> and enter the real amount.</Alert>}
              {skippedDups > 0 && <Alert severity="success" sx={{ mt: 1.5 }}>{skippedDups} shift{skippedDups === 1 ? ' is' : 's are'} already in the app and {skippedDups === 1 ? 'has' : 'have'} been left unticked.</Alert>}
              {result.alreadyImported && <Alert severity="warning" sx={{ mt: 1.5 }}>This exact message was already imported on {fmtDate(result.alreadyImported.at.slice(0, 10))} ({result.alreadyImported.jobCount} jobs).</Alert>}
              {result.unparsedLines.length > 0 && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>Not used: {result.unparsedLines.join(' · ')}</Typography>
              )}
            </CardContent>
          </Card>

          {jobs.length > 0 && (
            <Card>
              <CardContent>
                <Grid container spacing={2} alignItems="center">
                  {isRoster && (
                    <Grid size={12}>
                      <Autocomplete freeSolo options={(clients.data ?? []).map((c) => c.name)} value={employer}
                        onChange={(_, v) => applyEmployer(v ?? '')}
                        onInputChange={(_, v, reason) => { if (reason === 'input') { setEmployer(v); setJobs((js) => js.map((j) => ({ ...j, clientName: v.trim() }))); } }}
                        onBlur={() => applyEmployer(employer)}
                        renderInput={(p) => <TextField {...p} required label="Employer (who these shifts are for)" placeholder="e.g. the business name on your payslip" helperText="Used as the name on every shift below. Remembered for next time." />} />
                    </Grid>
                  )}
                  {isRoster && (
                    <Grid size={{ xs: 12, sm: 5 }}>
                      <TextField label="Expected pay per hour (optional)" type="number" value={rate} onChange={(e) => applyRate(e.target.value)}
                        slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }}
                        helperText={Number(rate) > 0 ? `About ${money(total)} expected — saved as an estimate` : 'Fills each shift with hours × rate as an estimate'} />
                    </Grid>
                  )}
                  <Grid size={{ xs: 12, sm: 5 }}>
                    <TextField select label="Income source for these jobs" value={sourceId} onChange={(e) => { setSourceId(e.target.value); applySourceDefaults(e.target.value); }}>
                      <MenuItem value="">None</MenuItem>
                      {(sources.data ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 7 }}>
                    <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={2}>
                      <FormControlLabel control={<Switch checked={createIncome} onChange={(e) => setCreateIncome(e.target.checked)} />} label="Create expected income records" />
                      <Tooltip title={calendarAvailable ? 'Adds each job to your Google Calendar (updates if you edit it later)' : 'Turn on Google Calendar sync for jobs in Settings → Integrations'}>
                        <FormControlLabel disabled={!calendarAvailable} control={<Switch checked={calendarAvailable && syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} />} label="Add to Google Calendar" />
                      </Tooltip>
                    </Stack>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 5 }}>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>Working as</Typography>
                    <ToggleButtonGroup exclusive size="small" value={workType} onChange={(_, v: WorkType | null) => v && setWorkType(v)} fullWidth>
                      <ToggleButton value="own">My own business</ToggleButton>
                      <ToggleButton value="subcontract">Under a contractor</ToggleButton>
                      <ToggleButton value="employee">Employee</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 7 }}>
                    {workType === 'subcontract' ? (
                      <Autocomplete freeSolo options={contractors} getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
                        value={contractors.find((c) => c.id === contractor.id) ?? contractor.name}
                        onChange={(_, v) => setContractor(v && typeof v === 'object' ? { id: v.id, name: v.name } : { name: (v as string) ?? '' })}
                        onInputChange={(_, v, reason) => reason === 'input' && setContractor({ name: v })}
                        renderInput={(p) => <TextField {...p} label="Contractor (who pays you & gets the invoice)" helperText={!contractor.id && contractor.name ? 'A new contractor will be created' : 'Pick one or type a new name'} />} />
                    ) : workType === 'employee' ? (
                      <Typography variant="body2" color="text.secondary" sx={{ pt: { sm: 2.5 } }}>Shifts for an employer who pays you wages. They never go on an invoice, and you can add the pay later.</Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ pt: { sm: 2.5 } }}>You'll invoice each client directly. Income is recorded against the client.</Typography>
                    )}
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          )}

          {jobs.map((j, idx) => {
            const p = j.parsed;
            const conf = p ? Math.round(p.confidence * 100) : 100;
            return (
              <Card key={j.tempId} sx={{ opacity: j.include ? 1 : 0.55, borderColor: p?.duplicateOfJobId ? 'warning.main' : undefined }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <Checkbox checked={j.include} onChange={(e) => updateJob(j.tempId, () => ({ include: e.target.checked }))} slotProps={{ input: { 'aria-label': `Include job ${idx + 1}` } }} />
                    <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{isRoster ? 'Shift' : 'Job'} {idx + 1}{isRoster && j.date ? ` · ${fmtDate(j.date, 'ddd D MMM')}` : j.clientName ? ` · ${j.clientName}` : ''}</Typography>
                    {p && <Chip size="small" label={`${conf}% confident`} color={conf >= 90 ? 'success' : conf >= 70 ? 'warning' : 'error'} variant="outlined" />}
                    {j.address?.line1 && <Tooltip title="Open in Google Maps"><IconButton size="small" component="a" href={mapsUrl([j.address.line1, j.address.suburb, j.address.state, j.address.postcode].filter(Boolean).join(', '))} target="_blank" rel="noreferrer"><PlaceOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
                    <Tooltip title="Remove"><IconButton size="small" onClick={() => setJobs((js) => js.filter((x) => x.tempId !== j.tempId))}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                  {p?.duplicateOfJobId && <Alert severity="warning" sx={{ mb: 1.5 }}>{isRoster ? 'This shift is already in the app, so it is left unticked.' : `A job for ${j.clientName} on this date/time already exists. Untick to skip it.`}</Alert>}
                  {p && p.warnings.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                      {p.warnings.map((w) => <Chip key={w} size="small" icon={<WarningAmberIcon />} label={w} color="warning" variant="outlined" />)}
                    </Stack>
                  )}
                  <Collapse in={j.include}>
                    <FieldGrid fields={jobFields} values={j} setValues={(fn) => updateJob(j.tempId, fn)} />
                    {p?.sourceText && <Typography variant="caption" color="text.secondary" component="pre" sx={{ mt: 1.5, mb: 0, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>{p.sourceText}</Typography>}
                  </Collapse>
                </CardContent>
              </Card>
            );
          })}

          {result.kind !== 'payment' && (
            <Button variant="outlined" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }}
              onClick={() => setJobs((js) => [...js, { tempId: `manual_${Date.now()}`, include: true, clientName: '', date: result.scheduleDate ?? localToday(), address: {}, tasks: [] }])}>
              {isRoster ? 'Add a missing shift' : 'Add a missing job'}
            </Button>
          )}

          {payments.map((pmt, idx) => (
            <Card key={pmt.tempId} sx={{ opacity: pmt.include ? 1 : 0.55 }}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                  <Checkbox checked={pmt.include} onChange={(e) => setPayments((ps) => ps.map((x) => (x.tempId === pmt.tempId ? { ...x, include: e.target.checked } : x)))} />
                  <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Payment {idx + 1}</Typography>
                </Stack>
                {pmt.warnings?.map((w: string) => <Chip key={w} size="small" icon={<WarningAmberIcon />} label={w} color="warning" variant="outlined" sx={{ mr: 1, mb: 1 }} />)}
                <FieldGrid
                  fields={[
                    { name: 'amount', label: 'Amount', type: 'money', required: true, span: 4 },
                    { name: 'date', label: 'Date received', type: 'date', required: true, span: 4 },
                    { name: 'payer', label: 'From', type: 'text', span: 4 },
                    { name: 'reference', label: 'Reference / invoice #', type: 'text', span: 6 },
                    { name: 'matchIncomeId', label: 'Match to existing income', type: 'select', span: 6, options: [{ value: '', label: 'Create new paid income' }, ...(result.paymentMatches[pmt.tempId] ?? []).filter((m) => m.incomeId).map((m) => ({ value: m.incomeId!, label: `Mark paid: ${m.label}` }))] },
                  ]}
                  values={pmt}
                  setValues={(fn) => setPayments((ps) => ps.map((x) => (x.tempId === pmt.tempId ? ({ ...x, ...fn(x) } as EditPayment) : x)))}
                />
              </CardContent>
            </Card>
          ))}

          {(jobs.length > 0 || payments.length > 0) && (
            <Card sx={{ position: 'sticky', bottom: { xs: 'calc(72px + env(safe-area-inset-bottom))', sm: 12 }, zIndex: 2, borderColor: 'primary.main' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2">{included.length} {isRoster ? 'shift(s)' : 'job(s)'} · {isRoster && !total ? `${totalHours.toFixed(1)} hours` : money(total)}{includedPayments.length ? ` · ${includedPayments.length} payment(s)` : ''}</Typography>
                    {invalid.length > 0 && <Typography variant="caption" color="error">{isRoster ? 'Enter the employer above (every shift needs one, and a date).' : 'Every job needs a client and a date.'}</Typography>}
                    {included.length > 0 && workType === 'subcontract' && !contractor.id && !contractor.name.trim() && <Typography variant="caption" color="error" component="div">Choose the contractor you're working under.</Typography>}
                    {included.length > 0 && <Typography variant="caption" color="text.secondary" component="div">{workType === 'employee' ? 'Paid as wages — not invoiced' : `Bill to: ${workType === 'subcontract' ? contractor.name || 'contractor' : 'each client'}`}</Typography>}
                    {(dupCount > 0 || result.alreadyImported) && (
                      <FormControlLabel control={<Checkbox size="small" checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />} label={<Typography variant="caption">Import anyway (I've checked these aren't duplicates)</Typography>} />
                    )}
                  </Box>
                  <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', sm: 'block' } }} />
                  <Button variant="contained" size="large" onClick={doImport} disabled={importing || (!included.length && !includedPayments.length) || invalid.length > 0 || (included.length > 0 && workType === 'subcontract' && !contractor.id && !contractor.name.trim()) || ((dupCount > 0 || !!result.alreadyImported) && !allowDuplicates)}>
                    {importing ? 'Importing…' : `Import${included.length ? ` ${included.length} ${isRoster ? 'shift' : 'job'}${included.length === 1 ? '' : 's'}` : ''}${includedPayments.length ? `${included.length ? ' +' : ''} ${includedPayments.length} payment${includedPayments.length === 1 ? '' : 's'}` : ''}`}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      )}
    </Box>
  );
}
