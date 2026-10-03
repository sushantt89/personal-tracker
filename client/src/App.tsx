import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AppLayout from './layout/AppLayout';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const MyDay = lazy(() => import('./pages/MyDay'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const PasteImport = lazy(() => import('./pages/PasteImport'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Clients = lazy(() => import('./pages/Clients'));
const IncomePage = lazy(() => import('./pages/IncomePage'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Bills = lazy(() => import('./pages/Bills'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceEditor = lazy(() => import('./pages/InvoiceEditor'));
const Documents = lazy(() => import('./pages/Documents'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Reports = lazy(() => import('./pages/Reports'));
const Insights = lazy(() => import('./pages/Insights'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const Assistant = lazy(() => import('./pages/Assistant'));

const Spinner = () => <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}><CircularProgress /></Box>;

function Unreachable() {
  const { refresh } = useAuth();
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ minHeight: '100dvh', p: 3, textAlign: 'center' }}>
      <CloudOffIcon color="disabled" sx={{ fontSize: 48 }} />
      <Typography variant="h6">Can’t reach Personal Tracker</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>You may be offline, or the app’s server isn’t running. Your data is safe — try again when you’re connected.</Typography>
      <Button variant="contained" onClick={() => refresh()}>Try again</Button>
    </Stack>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading, unreachable } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (unreachable) return <Unreachable />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading, unreachable } = useAuth();
  if (loading) return <Spinner />;
  if (unreachable) return <Unreachable />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="my-day" element={<MyDay />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="import" element={<PasteImport />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="clients" element={<Clients />} />
            <Route path="income" element={<IncomePage />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="bills" element={<Bills />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/new" element={<InvoiceEditor />} />
            <Route path="invoices/:id" element={<InvoiceEditor />} />
            <Route path="receipts" element={<Documents kind="receipt" />} />
            <Route path="documents" element={<Documents />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="reports" element={<Reports />} />
            <Route path="insights" element={<Insights />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
