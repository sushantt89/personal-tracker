import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions, Skeleton, Alert, LinearProgress,
  ToggleButtonGroup, ToggleButton, TextField, Tooltip, type ChipProps,
} from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { titleCase, money, pct, localToday, startOfMonth, endOfMonth, startOfWeek, addDays } from '../utils/format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" sx={{ mb: 2.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="h1">{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>{actions}</Stack>}
    </Stack>
  );
}

export function StatCard({ label, value, hint, tone, icon, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'positive' | 'negative' | 'warning' | 'neutral'; icon?: ReactNode; onClick?: () => void }) {
  const color = tone === 'positive' ? 'success.main' : tone === 'negative' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'text.primary';
  return (
    <Card sx={{ height: '100%', cursor: onClick ? 'pointer' : undefined, transition: 'border-color .15s', '&:hover': onClick ? { borderColor: 'primary.main' } : undefined }} onClick={onClick}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Typography>
          {icon && <Box sx={{ color: 'text.secondary', display: 'flex', '& svg': { fontSize: 20 } }}>{icon}</Box>}
        </Stack>
        <Typography variant="h5" sx={{ mt: 0.75, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

export function SectionCard({ title, subtitle, action, children, minHeight, noPad }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; minHeight?: number; noPad?: boolean }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {(title || action) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ px: 2, pt: 1.75, pb: 0.5 }} spacing={1}>
          <Box sx={{ minWidth: 0, flex: '1 1 140px' }}>
            {title && <Typography variant="subtitle2">{title}</Typography>}
            {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
      )}
      <Box sx={{ p: noPad ? 0 : 2, pt: noPad ? 0 : 1, flex: 1, minHeight }}>{children}</Box>
    </Card>
  );
}

export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 5, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      <Box sx={{ '& svg': { fontSize: 40, opacity: 0.6 } }}>{icon ?? <InboxOutlinedIcon />}</Box>
      <Typography variant="subtitle1" color="text.primary">{title}</Typography>
      {message && <Typography variant="body2" sx={{ maxWidth: 420 }}>{message}</Typography>}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

export const LoadingBlock = ({ rows = 4, height = 44 }: { rows?: number; height?: number }) => (
  <Stack spacing={1}>{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} variant="rounded" height={height} />)}</Stack>
);

export const ErrorBlock = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => (
  <Alert severity="error" action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
    {(error as Error)?.message ?? 'Something went wrong'}
  </Alert>
);

const STATUS_COLORS: Record<string, ChipProps['color']> = {
  paid: 'success', completed: 'success', active: 'success',
  expected: 'info', scheduled: 'info', sent: 'info', not_started: 'default',
  pending: 'warning', in_progress: 'warning', draft: 'default', due: 'warning',
  overdue: 'error', cancelled: 'default',
};
export const StatusChip = ({ status, size = 'small' }: { status?: string; size?: 'small' | 'medium' }) =>
  status ? <Chip size={size} label={titleCase(status)} color={STATUS_COLORS[status] ?? 'default'} variant={status === 'cancelled' || status === 'draft' ? 'outlined' : 'filled'} sx={{ textDecoration: status === 'cancelled' ? 'line-through' : undefined }} /> : null;

export function ProgressRow({ label, value, target, invert, format = money }: { label: string; value: number; target: number; invert?: boolean; format?: (n: number) => string }) {
  const p = pct(value, target);
  const over = target > 0 && value > target;
  const color = invert ? (over ? 'error' : p >= 85 ? 'warning' : 'primary') : p >= 100 ? 'success' : 'primary';
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }} spacing={1}>
        <Typography variant="body2" fontWeight={500}>{label}</Typography>
        <Typography variant="body2" color={over && invert ? 'error.main' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {format(value)} / {target > 0 ? format(target) : 'no target'}
        </Typography>
      </Stack>
      <Tooltip title={target > 0 ? `${Math.round((value / target) * 100)}%` : 'Set a target in Budgets'}>
        <LinearProgress variant="determinate" value={target > 0 ? p : 0} color={color} sx={{ height: 8, borderRadius: 4 }} />
      </Tooltip>
    </Box>
  );
}

// ---------- Confirm dialog ----------
interface ConfirmOpts { title: string; message?: ReactNode; confirmText?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onClose={() => close(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{state?.title}</DialogTitle>
        {state?.message && <DialogContent><Typography variant="body2" color="text.secondary" component="div">{state.message}</Typography></DialogContent>}
        <DialogActions>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="contained" color={state?.danger ? 'error' : 'primary'} onClick={() => close(true)} autoFocus>{state?.confirmText ?? 'Confirm'}</Button>
        </DialogActions>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Date range filter ----------
export type RangePreset = 'today' | 'week' | 'month' | 'last30' | 'year' | 'custom';
export interface DateRange { preset: RangePreset; from: string; to: string }
export function rangeFor(preset: RangePreset, today = localToday()): DateRange {
  switch (preset) {
    case 'today': return { preset, from: today, to: today };
    case 'week': return { preset, from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
    case 'last30': return { preset, from: addDays(today, -29), to: today };
    case 'year': return { preset, from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
    default: return { preset: 'month', from: startOfMonth(today), to: endOfMonth(today) };
  }
}
export function DateRangeBar({ value, onChange, presets = ['today', 'week', 'month', 'year', 'custom'] }: { value: DateRange; onChange: (r: DateRange) => void; presets?: RangePreset[] }) {
  const labels: Record<RangePreset, string> = { today: 'Day', week: 'Week', month: 'Month', last30: '30 days', year: 'Year', custom: 'Custom' };
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <ToggleButtonGroup size="small" exclusive value={value.preset} onChange={(_, p: RangePreset | null) => p && onChange(p === 'custom' ? { ...value, preset: 'custom' } : rangeFor(p))}>
        {presets.map((p) => <ToggleButton key={p} value={p} sx={{ px: 1.5 }}>{labels[p]}</ToggleButton>)}
      </ToggleButtonGroup>
      {value.preset === 'custom' && (
        <>
          <TextField type="date" label="From" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="date" label="To" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
        </>
      )}
    </Stack>
  );
}
