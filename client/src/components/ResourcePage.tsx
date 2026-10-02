import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Button, Card, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, IconButton, Menu, MenuItem, TextField, Stack, InputAdornment,
  Typography, useMediaQuery, useTheme, ListItemIcon, Divider, TablePagination, TableSortLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { get, post, patch, del } from '../api/client';
import { EntityFormDialog, type FieldDef, type Values } from './EntityForm';
import { PageHeader, EmptyState, LoadingBlock, ErrorBlock, useConfirm, DateRangeBar, rangeFor, type DateRange } from './common';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Column<T> { key: string; label: string; render?: (row: T) => ReactNode; align?: 'left' | 'right' | 'center'; hideOnMobile?: boolean; sortValue?: (row: T) => string | number; width?: number | string }
export interface RowAction<T> { label: string; icon?: ReactNode; onClick: (row: T) => void | Promise<void>; show?: (row: T) => boolean }
export interface FilterDef { name: string; label: string; options: { value: string; label: string }[] }

export interface ResourceConfig<T extends { id: string }> {
  queryKey: string;
  endpoint: string;
  title: string;
  singular: string;
  subtitle?: ReactNode;
  fields: FieldDef[];
  columns: Column<T>[];
  defaults: () => Values;
  fromRecord?: (row: T) => Values;
  dateFilter?: boolean;
  defaultRange?: DateRange['preset'];
  filters?: FilterDef[];
  rowActions?: RowAction<T>[];
  headerActions?: ReactNode;
  mobileTitle: (row: T) => ReactNode;
  mobileSubtitle?: (row: T) => ReactNode;
  mobileRight?: (row: T) => ReactNode;
  summary?: (items: T[]) => ReactNode;
  deleteMessage?: (row: T) => ReactNode;
  extraQuery?: Record<string, string>;
  beforeList?: ReactNode;
  /** Applied to form values before saving */
  transform?: (v: Values) => Values;
}

export function ResourcePage<T extends { id: string }>({ config }: { config: ResourceConfig<T> }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [range, setRange] = useState<DateRange>(rangeFor(config.defaultRange ?? 'month'));
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries((config.filters ?? []).map((f) => [f.name, params.get(f.name) ?? ''])));
  const [editing, setEditing] = useState<{ row?: T; initial: Values } | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; row: T } | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(0), [debounced, range, filters]);

  const query = { q: debounced, ...(config.dateFilter && range.preset !== ('all' as any) ? { from: range.from, to: range.to } : {}), ...filters, ...(config.extraQuery ?? {}) };
  const list = useQuery({ queryKey: [config.queryKey, query], queryFn: () => get<{ items: T[]; total: number }>(config.endpoint, query) });

  // Open the edit dialog for ?focus=<id> links (from search / notifications)
  const focus = params.get('focus');
  useEffect(() => {
    if (!focus) return;
    get<T>(`${config.endpoint}/${focus}`).then((row) => setEditing({ row, initial: config.fromRecord ? config.fromRecord(row) : (row as any) })).catch(() => toast('Record not found', 'error'));
    params.delete('focus');
    setParams(params, { replace: true });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (raw: Values) => { const v = config.transform ? config.transform(raw) : raw; return editing?.row ? patch(`${config.endpoint}/${editing.row.id}`, v) : post(config.endpoint, v); },
    onSuccess: () => { invalidate(); toast(`${config.singular} ${editing?.row ? 'updated' : 'added'}`); },
  });

  const remove = async (row: T) => {
    const ok = await confirm({ title: `Delete this ${config.singular.toLowerCase()}?`, message: config.deleteMessage?.(row) ?? 'This cannot be undone. A record of the deletion is kept in the audit log.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await del(`${config.endpoint}/${row.id}`);
      invalidate();
      toast(`${config.singular} deleted`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const items = useMemo(() => {
    const xs = list.data?.items ?? [];
    if (!sort) return xs;
    const col = config.columns.find((c) => c.key === sort.key);
    const val = (r: T) => (col?.sortValue ? col.sortValue(r) : (r as any)[sort.key] ?? '');
    return [...xs].sort((a, b) => { const va = val(a), vb = val(b); const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb)); return sort.dir === 'asc' ? c : -c; });
  }, [list.data, sort, config.columns]);
  const paged = items.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const openNew = () => setEditing({ initial: config.defaults() });
  const openEdit = (row: T) => setEditing({ row, initial: config.fromRecord ? config.fromRecord(row) : (row as any) });

  return (
    <Box>
      <PageHeader title={config.title} subtitle={config.subtitle} actions={<>{config.headerActions}<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Add {config.singular.toLowerCase()}</Button></>} />
      {config.beforeList}
      <Card sx={{ mb: 2, p: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField placeholder={`Search ${config.title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, maxWidth: { sm: 320 } }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
          {config.dateFilter && <DateRangeBar value={range} onChange={setRange} presets={['week', 'month', 'last30', 'year', 'custom']} />}
          {(config.filters ?? []).map((f) => (
            <TextField key={f.name} select label={f.label} value={filters[f.name] ?? ''} onChange={(e) => setFilters((p) => ({ ...p, [f.name]: e.target.value }))} sx={{ flex: { xs: '1 1 130px', sm: '0 1 170px' }, minWidth: 0 }}>
              <MenuItem value="">All</MenuItem>
              {f.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          ))}
        </Stack>
      </Card>
      {config.summary && list.data && <Box sx={{ mb: 2 }}>{config.summary(items)}</Box>}

      <Card>
        {list.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock /></Box> : list.error ? <Box sx={{ p: 2 }}><ErrorBlock error={list.error} onRetry={list.refetch} /></Box> : !items.length ? (
          <EmptyState title={`No ${config.title.toLowerCase()} found`} message={debounced || Object.values(filters).some(Boolean) ? 'Try a different search or filter.' : `Add your first ${config.singular.toLowerCase()} to get started.`} action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openNew}>Add {config.singular.toLowerCase()}</Button>} />
        ) : mobile ? (
          <Box>
            {paged.map((row, i) => (
              <Box key={row.id}>
                {i > 0 && <Divider />}
                <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, minHeight: 56, cursor: 'pointer', '&:active': { bgcolor: 'action.hover' } }} onClick={() => openEdit(row)}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap component="div">{config.mobileTitle(row)}</Typography>
                    {config.mobileSubtitle && <Typography variant="caption" color="text.secondary" component="div" noWrap>{config.mobileSubtitle(row)}</Typography>}
                  </Box>
                  {config.mobileRight && <Box sx={{ textAlign: 'right' }}>{config.mobileRight(row)}</Box>}
                  <IconButton aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, row }); }} sx={{ mr: -1 }}><MoreVertIcon fontSize="small" /></IconButton>
                </Stack>
              </Box>
            ))}
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {config.columns.map((c) => (
                    <TableCell key={c.key} align={c.align} sx={{ width: c.width, whiteSpace: 'nowrap' }}>
                      <TableSortLabel active={sort?.key === c.key} direction={sort?.key === c.key ? sort.dir : 'asc'} onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))}>{c.label}</TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell width={48} />
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map((row) => (
                  <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => openEdit(row)}>
                    {config.columns.map((c) => <TableCell key={c.key} align={c.align} sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.render ? c.render(row) : String((row as any)[c.key] ?? '')}</TableCell>)}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" aria-label="More actions" onClick={(e) => setMenu({ el: e.currentTarget, row })}><MoreVertIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {items.length > 10 && (
          <TablePagination component="div" count={items.length} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
        )}
      </Card>

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { openEdit(menu!.row); setMenu(null); }}><ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>Edit</MenuItem>
        {(config.rowActions ?? []).filter((a) => !menu || !a.show || a.show(menu.row)).map((a) => (
          <MenuItem key={a.label} onClick={async () => { const row = menu!.row; setMenu(null); await a.onClick(row); }}>{a.icon && <ListItemIcon>{a.icon}</ListItemIcon>}{a.label}</MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { const row = menu!.row; setMenu(null); remove(row); }} sx={{ color: 'error.main' }}><ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>Delete</MenuItem>
      </Menu>

      <EntityFormDialog open={!!editing} title={editing?.row ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`} fields={config.fields} initial={editing?.initial ?? {}} onSubmit={(v) => save.mutateAsync(v)} onClose={() => setEditing(null)} />
    </Box>
  );
}
