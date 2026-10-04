import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { get } from '../api/client';
import type { Expense, Income } from '../api/types';
import { LoadingBlock, ErrorBlock } from './common';
import { money, fmtDate, fmtShort } from '../utils/format';
import { useLookupMaps } from '../hooks/useLookups';

interface Row { id: string; date: string; title: string; sub: string; amount: number; chip?: { label: string; color: 'success' | 'info' } }
interface Group { name: string; total: number; count: number; color?: string }

/** Where this week's income or spending figure on the Budgets page comes from: totals by source/category, then every record. */
export default function WeekBreakdownDialog({ kind, from, to, onClose }: { kind: 'income' | 'expenses' | null; from: string; to: string; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const nav = useNavigate();
  const { srcById, catById } = useLookupMaps();
  const q = useQuery({
    queryKey: [kind === 'income' ? 'income' : 'expenses', 'week-breakdown', from, to], enabled: !!kind,
    queryFn: () => get<{ items: (Income | Expense)[] }>(kind === 'income' ? '/income' : '/expenses', { from, to, limit: 500 }),
  });

  let rows: Row[] = [], groups: Group[] = [], received = 0, expected = 0;
  const add = (m: Map<string, Group>, name: string, amount: number, color?: string) => { const g = m.get(name) ?? { name, total: 0, count: 0, color }; g.total += amount; g.count++; m.set(name, g); };
  if (q.data && kind === 'income') {
    const items = (q.data.items as Income[]).filter((i) => i.status !== 'cancelled');
    const m = new Map<string, Group>();
    for (const i of items) {
      const src = (i.incomeSourceId && srcById.get(i.incomeSourceId)?.name) || 'No source';
      add(m, src, i.amount);
      if (i.status === 'paid') received += i.amount; else expected += i.amount;
      rows.push({ id: i.id, date: i.date, title: i.clientName || i.description || 'Income', sub: [src, i.clientName && i.description].filter(Boolean).join(' · '), amount: i.amount, chip: i.status === 'paid' ? { label: 'Received', color: 'success' } : { label: 'Expected', color: 'info' } });
    }
    groups = [...m.values()];
  } else if (q.data && kind === 'expenses') {
    const m = new Map<string, Group>();
    for (const e of q.data.items as Expense[]) {
      const cat = e.categoryId ? catById.get(e.categoryId) : undefined;
      add(m, cat?.name ?? 'Uncategorised', e.amount, cat?.color);
      const title = e.description || e.merchant || cat?.name || 'Expense';
      const catName = cat?.name ?? 'Uncategorised';
      // Don't repeat the title in the line underneath
      const sub = [catName !== title ? catName : '', e.merchant && e.merchant !== title && e.merchant !== catName ? e.merchant : '', e.billId ? 'Recurring bill' : ''].filter(Boolean).join(' · ');
      rows.push({ id: e.id, date: e.date, title, sub, amount: e.amount });
    }
    groups = [...m.values()];
  }
  groups.sort((a, b) => b.total - a.total);
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const label = kind === 'income' ? 'Income this week' : 'Spent this week';

  return (
    <Dialog open={!!kind} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} scroll="paper">
      <DialogTitle>
        {label}
        <Typography variant="body2" color="text.secondary">{fmtShort(from)} – {fmtShort(to)}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        {q.isLoading ? <LoadingBlock rows={5} /> : q.error ? <ErrorBlock error={q.error} onRetry={q.refetch} /> : !rows.length ? (
          <Typography variant="body2" color="text.secondary">{kind === 'income' ? 'No income is recorded for this week yet.' : 'Nothing is recorded as spent this week yet.'}</Typography>
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(total)}</Typography>
              {kind === 'income' && <Typography variant="body2" color="text.secondary">{money(received)} received · {money(expected)} still expected</Typography>}
              {kind === 'expenses' && <Typography variant="body2" color="text.secondary">{rows.length} expense{rows.length === 1 ? '' : 's'}</Typography>}
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{kind === 'income' ? 'By source' : 'By category'}</Typography>
              <Stack spacing={1.25}>
                {groups.map((g) => (
                  <Box key={g.name}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography variant="body2" noWrap>{g.name} <Typography component="span" variant="caption" color="text.secondary">· {g.count}</Typography></Typography>
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><b>{money(g.total)}</b> <Typography component="span" variant="caption" color="text.secondary">{total > 0 ? Math.round((g.total / total) * 100) : 0}%</Typography></Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={total > 0 ? Math.min(100, (g.total / total) * 100) : 0} aria-label={`${g.name} share`}
                      sx={{ height: 6, borderRadius: 3, mt: 0.5, ...(g.color ? { bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: g.color } } : {}) }} color={kind === 'income' ? 'success' : 'primary'} />
                  </Box>
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Every {kind === 'income' ? 'payment' : 'expense'}</Typography>
              <Stack divider={<Divider flexItem />}>
                {rows.map((r) => (
                  <Stack key={r.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 58, flexShrink: 0 }}>{fmtDate(r.date, 'ddd D')}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{r.title}</Typography>
                      {r.sub && <Typography variant="caption" color="text.secondary" component="div" noWrap>{r.sub}</Typography>}
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</Typography>
                      {r.chip && <Chip size="small" variant="outlined" color={r.chip.color} label={r.chip.label} sx={{ height: 20, mt: 0.25 }} />}
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button color="inherit" onClick={() => nav(kind === 'income' ? '/income' : '/expenses')}>Open {kind === 'income' ? 'Income' : 'Expenses'}</Button>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
