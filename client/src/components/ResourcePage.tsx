import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Button, Card, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, IconButton, Menu, MenuItem, TextField, Stack, InputAdornment,
  Typography, useMediaQuery, useTheme, ListItemIcon, Divider, TablePagination, TableSortLabel, Checkbox, Collapse, alpha,
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
import SwipeAction, { useSwipe } from './SwipeAction';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Column<T> { key: string; label: string; render?: (row: T) => ReactNode; align?: 'left' | 'right' | 'center'; hideOnMobile?: boolean; sortValue?: (row: T) => string | number; width?: number | string }
export interface RowAction<T> { label: string; icon?: ReactNode; onClick: (row: T) => void | Promise<void>; show?: (row: T) => boolean }
/** Something done to every selected row at once */
export interface BulkAction<T> { label: string; icon?: ReactNode; /** Return false to keep the rows selected (e.g. the person cancelled) */ onClick: (rows: T[]) => void | boolean | Promise<void | boolean>; variant?: 'contained' | 'outlined' | 'text'; color?: 'primary' | 'error' | 'inherit' }
/** Swipe a row left to do one thing to it */
export interface SwipeDef<T> { label: string; onAction: (row: T) => void | Promise<void>; show?: (row: T) => boolean }
export interface FilterDef<T = any> {
  name: string; label: string; options: { value: string; label: string }[];
  /** What is selected when the page opens (a link such as ?status=completed still wins) */
  defaultValue?: string;
  /** Apply this filter in the browser instead of on the server, so the summary above the list still covers every row */
  clientSide?: (row: T, value: string) => boolean;
}

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
  filters?: FilterDef<T>[];
  rowActions?: RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  swipe?: SwipeDef<T>;
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

/** A table row that can be dragged left to run the row's swipe action. */
function SwipeTableRow({ label, onAction, disabled, selected, onClick, children }: { label: string; onAction: () => void | Promise<void>; disabled?: boolean; selected?: boolean; onClick: () => void; children: ReactNode }) {
  const { handlers, dx, dragging, armed, busy } = useSwipe<HTMLTableRowElement>(onAction, disabled);
  const on = dx < 0 || busy;
  return (
    <TableRow hover selected={selected} onClick={onClick} {...handlers} title={disabled ? undefined : `Drag left: ${label}`}
      sx={(t) => ({
        cursor: dragging ? 'grabbing' : 'pointer', touchAction: 'pan-y', userSelect: dragging ? 'none' : undefined,
        transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform .2s ease-out, background-color .15s',
        ...(on ? { bgcolor: `${alpha(t.palette.success.main, armed || busy ? 0.3 : 0.1)} !important`, boxShadow: `inset -6px 0 0 ${t.palette.success.main}` } : {}),
      })}>
      {children}
    </TableRow>
  );
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
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    // A link that names any filter (e.g. ?pay=unset from a notification) shows exactly that, without the page's defaults on top
    const linked = (config.filters ?? []).some((f) => params.has(f.name));
    return Object.fromEntries((config.filters ?? []).map((f) => [f.name, params.get(f.name) ?? (linked ? '' : f.defaultValue ?? '')]));
  });
  const [editing, setEditing] = useState<{ row?: T; initial: Values } | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; row: T } | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectable = !!config.bulkActions?.length;

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(0), [debounced, range, filters]);

  const localFilters = (config.filters ?? []).filter((f) => f.clientSide);
  const query = { q: debounced, ...(config.dateFilter && range.preset !== ('all' as any) ? { from: range.from, to: range.to } : {}), ...Object.fromEntries(Object.entries(filters).filter(([name]) => !localFilters.some((f) => f.name === name))), ...(config.extraQuery ?? {}) };
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

  // Everything the server returned (the summary uses this) …
  const allItems = list.data?.items ?? [];
  // … and what is listed, after the filters that are applied here in the browser
  const items = useMemo(() => {
    const xs = allItems.filter((r) => localFilters.every((f) => !filters[f.name] || f.clientSide!(r, filters[f.name])));
    if (!sort) return xs;
    const col = config.columns.find((c) => c.key === sort.key);
    const val = (r: T) => (col?.sortValue ? col.sortValue(r) : (r as any)[sort.key] ?? '');
    return [...xs].sort((a, b) => { const va = val(a), vb = val(b); const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb)); return sort.dir === 'asc' ? c : -c; });
  }, [list.data, sort, config.columns, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const paged = items.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  // Selection only ever covers rows that are still in the list
  const chosen = items.filter((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageAll = paged.length > 0 && paged.every((r) => selected.has(r.id));
  const togglePage = () => setSelected((s) => { const n = new Set(s); for (const r of paged) { if (pageAll) n.delete(r.id); else n.add(r.id); } return n; });
  const runBulk = async (a: BulkAction<T>) => {
    setBulkBusy(true);
    try { if ((await a.onClick(chosen)) !== false) setSelected(new Set()); } catch (e) { toast((e as Error).message, 'error'); } finally { setBulkBusy(false); }
  };
  const canSwipe = (row: T) => !!config.swipe && (!config.swipe.show || config.swipe.show(row));
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
      {config.summary && list.data && <Box sx={{ mb: 2 }}>{config.summary(allItems)}</Box>}

      {selectable && (
        <Collapse in={chosen.length > 0} unmountOnExit>
          <Card sx={{ mb: 2, px: 2, py: 1, position: 'sticky', top: { xs: 64, md: 72 }, zIndex: 5, border: 1, borderColor: 'primary.main' }} role="region" aria-label="Selected rows">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" fontWeight={700} sx={{ mr: 0.5 }}>{chosen.length} selected</Typography>
              {config.bulkActions!.map((a) => <Button key={a.label} size="small" variant={a.variant ?? 'outlined'} color={a.color ?? 'primary'} startIcon={a.icon} disabled={bulkBusy} onClick={() => runBulk(a)}>{a.label}</Button>)}
              <Box sx={{ flex: 1 }} />
              {items.length > chosen.length && <Button size="small" color="inherit" onClick={() => setSelected(new Set(items.map((r) => r.id)))}>Select all {items.length}</Button>}
              <Button size="small" color="inherit" onClick={() => setSelected(new Set())}>Clear</Button>
            </Stack>
          </Card>
        </Collapse>
      )}

      <Card>
        {list.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock /></Box> : list.error ? <Box sx={{ p: 2 }}><ErrorBlock error={list.error} onRetry={list.refetch} /></Box> : !items.length ? (
          <EmptyState title={`No ${config.title.toLowerCase()} found`} message={allItems.length > 0 ? `${allItems.length} hidden by the ${localFilters.map((f) => f.label.toLowerCase()).join(' / ')} filter — set it to All to see them.` : debounced || Object.values(filters).some(Boolean) ? 'Try a different search or filter.' : `Add your first ${config.singular.toLowerCase()} to get started.`} action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openNew}>Add {config.singular.toLowerCase()}</Button>} />
        ) : mobile ? (
          <Box>
            {selectable && (
              <>
                <Stack direction="row" alignItems="center" sx={{ pl: 0.5, pr: 2, minHeight: 44 }}>
                  <Checkbox checked={pageAll} indeterminate={!pageAll && paged.some((r) => selected.has(r.id))} onChange={togglePage} slotProps={{ input: { 'aria-label': 'Select all on this page' } }} />
                  <Typography variant="caption" color="text.secondary">Select all{config.swipe ? ` · swipe a row left to mark it ${config.swipe.label.toLowerCase()}` : ''}</Typography>
                </Stack>
                <Divider />
              </>
            )}
            {paged.map((row, i) => { const rowEl = (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: selectable ? 0.5 : 2, pr: 2, py: 1.25, minHeight: 56, cursor: 'pointer', bgcolor: selected.has(row.id) ? 'action.selected' : undefined, '&:active': { bgcolor: 'action.hover' } }} onClick={() => openEdit(row)}>
                  {selectable && <Checkbox checked={selected.has(row.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(row.id)} slotProps={{ input: { 'aria-label': 'Select row' } }} sx={{ mr: -0.5 }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap component="div">{config.mobileTitle(row)}</Typography>
                    {config.mobileSubtitle && <Typography variant="caption" color="text.secondary" component="div" noWrap>{config.mobileSubtitle(row)}</Typography>}
                  </Box>
                  {config.mobileRight && <Box sx={{ textAlign: 'right' }}>{config.mobileRight(row)}</Box>}
                  <IconButton aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, row }); }} sx={{ mr: -1 }}><MoreVertIcon fontSize="small" /></IconButton>
                </Stack>
              );
              return (
              <Box key={row.id}>
                {i > 0 && <Divider />}
                {canSwipe(row) ? <SwipeAction label={config.swipe!.label} onAction={() => config.swipe!.onAction(row)}>{rowEl}</SwipeAction> : rowEl}
              </Box>
              ); })}
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {selectable && <TableCell padding="checkbox"><Checkbox checked={pageAll} indeterminate={!pageAll && paged.some((r) => selected.has(r.id))} onChange={togglePage} slotProps={{ input: { 'aria-label': 'Select all on this page' } }} /></TableCell>}
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
                  <SwipeTableRow key={row.id} label={config.swipe?.label ?? ''} disabled={!canSwipe(row)} onAction={() => config.swipe!.onAction(row)} selected={selected.has(row.id)} onClick={() => openEdit(row)}>
                    {selectable && <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(row.id)} onChange={() => toggle(row.id)} slotProps={{ input: { 'aria-label': 'Select row' } }} /></TableCell>}
                    {config.columns.map((c) => <TableCell key={c.key} align={c.align} sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.render ? c.render(row) : String((row as any)[c.key] ?? '')}</TableCell>)}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" aria-label="More actions" onClick={(e) => setMenu({ el: e.currentTarget, row })}><MoreVertIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </SwipeTableRow>
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
