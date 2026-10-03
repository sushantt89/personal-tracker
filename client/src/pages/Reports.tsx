import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Card, Tabs, Tab, Stack, TextField, MenuItem, Button, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Typography, Menu, ListItemIcon, ListItemText, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import GridOnIcon from '@mui/icons-material/GridOn';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { get, fileUrl } from '../api/client';
import { PageHeader, DateRangeBar, rangeFor, LoadingBlock, ErrorBlock, SectionCard, EmptyState, type DateRange } from '../components/common';
import { BarSeriesChart, LineSeriesChart } from '../components/charts';
import { money, titleCase, fmtMonth, fmtShort, fmtDate } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
type T = 'income' | 'expenses' | 'cashflow' | 'work';
interface Column { key: string; label: string; kind: 'text' | 'date' | 'money' | 'int' | 'number' | 'km' }
interface Report { columns: Column[]; rows: Record<string, any>[]; totals: Record<string, number>; detailColumns: Column[]; detail: Record<string, any>[] }

const GROUPS: Record<T, string[]> = {
  income: ['day', 'week', 'month', 'year', 'source', 'client', 'paymentMethod'],
  expenses: ['day', 'week', 'month', 'year', 'category', 'merchant', 'paymentMethod'],
  cashflow: ['day', 'week', 'month', 'year'],
  work: ['day', 'week', 'month', 'year', 'client', 'contractor', 'workType', 'source'],
};
const GROUP_LABEL: Record<string, string> = { paymentMethod: 'Payment method', workType: 'Own business, contractor or employee' };
const CHART: Record<T, { key: string; name: string }[]> = {
  income: [{ key: 'paid', name: 'Received' }, { key: 'expected', name: 'Expected' }],
  expenses: [{ key: 'total', name: 'Spent' }],
  cashflow: [{ key: 'income', name: 'Income' }, { key: 'expenses', name: 'Expenses' }],
  work: [{ key: 'total', name: 'Job income' }],
};

export default function Reports() {
  const [type, setType] = useState<T>('income');
  const [range, setRange] = useState<DateRange>(rangeFor('year'));
  const [groupBy, setGroupBy] = useState('month');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const g = GROUPS[type].includes(groupBy) ? groupBy : 'month';
  const q = useQuery({ queryKey: ['reports', type, range.from, range.to, g], queryFn: () => get<Report>(`/reports/${type}`, { from: range.from, to: range.to, groupBy: g }) });
  const isPeriod = ['day', 'week', 'month', 'year'].includes(g);
  const fmtGroup = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? fmtMonth(v) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtShort(v) : v);
  const fmt = (c: Column, v: any) => {
    if (v === undefined || v === null || v === '') return '';
    if (c.key === 'group') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : fmtGroup(String(v));
    if (c.kind === 'money') return money(Number(v));
    if (c.kind === 'km') return `${Number(v).toFixed(1)} km`;
    if (c.kind === 'number') return Number(v).toFixed(2);
    if (c.kind === 'date') return fmtDate(String(v));
    return String(v);
  };
  const link = (format: string, extra: Record<string, string> = {}, t: string = type) => fileUrl(`/reports/${t}`, { from: range.from, to: range.to, groupBy: g, format, ...extra });
  const rows = q.data?.rows ?? [];
  const cols = q.data?.columns ?? [];
  const numeric = (c: Column) => c.key !== 'group' && c.kind !== 'text' && c.kind !== 'date';

  return (
    <Box>
      <PageHeader title="Reports" subtitle="Income, expenses, cash flow and work, grouped any way you need."
        actions={<>
          <Button variant="contained" startIcon={<GridOnIcon />} href={link('xlsx')}>Excel</Button>
          <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon />} href={link('pdf')}>PDF</Button>
          <Button startIcon={<DownloadIcon />} onClick={(e) => setMenu(e.currentTarget)}>More</Button>
        </>} />
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem component="a" href={link('pdf', { detail: 'true' })} onClick={() => setMenu(null)}><ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary="PDF with every record" /></MenuItem>
        <MenuItem component="a" href={link('csv')} onClick={() => setMenu(null)}><ListItemIcon><DescriptionOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary="Summary CSV" /></MenuItem>
        {type !== 'cashflow' && <MenuItem component="a" href={link('csv', { detail: 'true' })} onClick={() => setMenu(null)}><ListItemIcon><DescriptionOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary="Detail CSV" /></MenuItem>}
        <Divider />
        <MenuItem component="a" href={link('xlsx', {}, 'all')} onClick={() => setMenu(null)}><ListItemIcon><GridOnIcon fontSize="small" /></ListItemIcon><ListItemText primary="Full financial report (Excel)" secondary="Summary + all four reports by month + every record" /></MenuItem>
        <MenuItem component="a" href={link('pdf', {}, 'all')} onClick={() => setMenu(null)}><ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary="Full financial report (PDF)" secondary="All four reports by month, with charts" /></MenuItem>
      </Menu>
      <Card sx={{ mb: 2 }}>
        <Tabs value={type} onChange={(_, v) => setType(v)} variant="scrollable" allowScrollButtonsMobile sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="income" label="Income" /><Tab value="expenses" label="Expenses" /><Tab value="cashflow" label="Profit / cash flow" /><Tab value="work" label="Work" />
        </Tabs>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 1.5 }} alignItems={{ md: 'center' }}>
          <DateRangeBar value={range} onChange={setRange} presets={['month', 'last30', 'year', 'custom']} />
          <TextField select label="Group by" value={g} onChange={(e) => setGroupBy(e.target.value)} sx={{ maxWidth: { md: 240 } }}>
            {GROUPS[type].map((x) => <MenuItem key={x} value={x}>{GROUP_LABEL[x] ?? titleCase(x)}</MenuItem>)}
          </TextField>
        </Stack>
      </Card>
      {q.isLoading ? <LoadingBlock rows={6} /> : q.error ? <ErrorBlock error={q.error} /> : !rows.length ? <Card><EmptyState title="No data in this range" /></Card> : (
        <Stack spacing={2}>
          <SectionCard title={type === 'cashflow' ? 'Income − expenses = net cash flow' : `${titleCase(type)} by ${(cols[0]?.label ?? g).toLowerCase()}`}>
            {type === 'cashflow' && isPeriod
              ? <LineSeriesChart data={rows} xKey="group" xFormatter={fmtGroup} series={[...CHART.cashflow, { key: 'net', name: 'Net', dashed: true }]} />
              : <BarSeriesChart data={rows.slice(0, 40)} xKey="group" xFormatter={fmtGroup} series={CHART[type]} stacked={type === 'income'} horizontal={!isPeriod} height={!isPeriod ? Math.max(200, Math.min(rows.length, 15) * 30) : 280} />}
          </SectionCard>
          <Card>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>{cols.map((c) => <TableCell key={c.key} align={numeric(c) ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>{c.label}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {rows.map((r, i) => <TableRow key={i} hover>{cols.map((c) => <TableCell key={c.key} align={numeric(c) ? 'right' : 'left'} sx={{ fontVariantNumeric: 'tabular-nums', color: c.kind === 'money' && Number(r[c.key]) < 0 ? 'error.main' : undefined }}>{fmt(c, r[c.key])}</TableCell>)}</TableRow>)}
                  <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
                    {cols.map((c) => <TableCell key={c.key} align={numeric(c) ? 'right' : 'left'}>{c.key === 'group' ? 'Total' : q.data!.totals[c.key] !== undefined ? fmt(c, q.data!.totals[c.key]) : ''}</TableCell>)}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
          <Typography variant="caption" color="text.secondary">Excel files have a formatted summary sheet with live totals plus a sheet with every record. PDFs include a chart and the summary table.</Typography>
        </Stack>
      )}
    </Box>
  );
}
