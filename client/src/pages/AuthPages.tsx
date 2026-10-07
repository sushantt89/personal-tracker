import { useState, type ReactNode, type FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Card, CardContent, Typography, TextField, Button, Alert, Link, Stack, Divider } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { User } from '../api/types';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, background: (t) => (t.palette.mode === 'dark' ? 'radial-gradient(circle at 20% 10%, #1e1b4b, #0f1115 60%)' : 'radial-gradient(circle at 20% 10%, #e0e7ff, #f6f7f9 60%)') }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 3 }}>
            <Box component="img" src="/favicon.svg" alt="" sx={{ width: 34, height: 34 }} />
            <Typography variant="h6" fontWeight={700}>Personal Tracker</Typography>
          </Stack>
          <Typography variant="h5" gutterBottom>{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{subtitle}</Typography>}
          {children}
          <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
            <Link component={RouterLink} to="/privacy" variant="caption" color="text.secondary">Privacy policy</Link>
            <Link component={RouterLink} to="/terms" variant="caption" color="text.secondary">Terms of service</Link>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { return await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Google sign-in.',
  email_not_verified: 'That Google account’s email address isn’t verified, so it can’t be used to sign in.',
  expired_or_invalid_state: 'The Google sign-in took too long or was started in another browser. Please try again.',
  sign_in_failed: 'Google sign-in didn’t work. Please try again, or log in with your email and password.',
};

/** "Continue with Google" — shown only when the server has Google set up. Signs in, or creates the account the first time. */
function GoogleButton({ onError }: { onError: (msg: string) => void }) {
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => api<{ google: boolean }>('/auth/providers'), staleTime: 5 * 60 * 1000, retry: false });
  const [busy, setBusy] = useState(false);
  if (!providers.data?.google) return null;
  const go = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/integrations/google/login-url');
      window.location.assign(url);
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <Divider sx={{ color: 'text.secondary', fontSize: 13 }}>or</Divider>
      <Button variant="outlined" size="large" color="inherit" startIcon={<GoogleIcon />} onClick={go} disabled={busy} sx={{ borderColor: 'divider' }}>{busy ? 'Opening Google…' : 'Continue with Google'}</Button>
    </>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [params] = useSearchParams();
  const [googleError, setGoogleError] = useState<string | null>(() => (params.get('google') === 'error' ? GOOGLE_ERRORS[params.get('reason') ?? ''] ?? GOOGLE_ERRORS.sign_in_failed : null));
  const { error, busy, submit } = useSubmit(async () => {
    const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    qc.setQueryData(['me'], r.user);
    nav(loc.state?.from ?? '/', { replace: true });
  });
  return (
    <Shell title="Welcome back" subtitle="Log in to see your day, work and money at a glance.">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          {(error || googleError) && <Alert severity="error">{error ?? googleError}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</Button>
          <GoogleButton onError={setGoogleError} />
          <Stack direction="row" justifyContent="space-between">
            <Link component={RouterLink} to="/forgot-password" variant="body2">Forgot password?</Link>
            <Link component={RouterLink} to="/register" variant="body2">Create account</Link>
          </Stack>
        </Stack>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const { error, busy, submit } = useSubmit(async () => {
    if (form.password !== form.confirm) throw new Error('Passwords do not match');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await api<{ user: User }>('/auth/register', { method: 'POST', body: { name: form.name, email: form.email, password: form.password, timezone } });
    qc.setQueryData(['me'], r.user);
    nav('/', { replace: true });
  });
  const [googleError, setGoogleError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Shell title="Create your account" subtitle="Your data is private to your account.">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          {(error || googleError) && <Alert severity="error">{error ?? googleError}</Alert>}
          <TextField label="Name" value={form.name} onChange={set('name')} required autoFocus autoComplete="name" />
          <TextField label="Email" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          <TextField label="Password" type="password" value={form.password} onChange={set('password')} required helperText="At least 8 characters" autoComplete="new-password" />
          <TextField label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
          <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
          <GoogleButton onError={setGoogleError} />
          <Link component={RouterLink} to="/login" variant="body2">Already have an account? Log in</Link>
        </Stack>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const { error, busy, submit } = useSubmit(async () => {
    const r = await api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email } });
    setSent(r.message);
  });
  return (
    <Shell title="Reset your password" subtitle="We'll email you a link to set a new password.">
      {sent ? <Alert severity="success">{sent}</Alert> : (
        <form onSubmit={submit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <Button type="submit" variant="contained" disabled={busy}>Send reset link</Button>
          </Stack>
        </form>
      )}
      <Link component={RouterLink} to="/login" variant="body2" sx={{ display: 'block', mt: 2 }}>Back to log in</Link>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/reset-password', { method: 'POST', body: { token: params.get('token') ?? '', password } });
    setDone(true);
    setTimeout(() => nav('/login'), 1500);
  });
  return (
    <Shell title="Choose a new password">
      {done ? <Alert severity="success">Password updated. Redirecting to log in…</Alert> : (
        <form onSubmit={submit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required helperText="At least 8 characters" autoFocus />
            <Button type="submit" variant="contained" disabled={busy}>Update password</Button>
          </Stack>
        </form>
      )}
    </Shell>
  );
}
