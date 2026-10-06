import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Button, Card, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Stack, TextField, MenuItem, InputAdornment, IconButton, Menu, ListItemIcon, Divider, Typography, Grid, useMediaQuery, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import { get, post, del, fileUrl } from '../api/client';
import type { Invoice, InvoiceTemplate } from '../api/types';
import { PageHeader, StatusChip, EmptyState, LoadingBlock, ErrorBlock, StatCard, useConfirm } from '../components/common';
import { money, fmtDate } from '../utils/format';
import { useInvalidateFinance } from '../hooks/useInvalidate';
import { useToast } from '../hooks/useToast';
import { markInvoicePaid, setInvoiceStatus } from './invoiceActions';

export default function Invoices() {
  const nav = useNavigate();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateFinance();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ el: HTMLElement; inv: Invoice } | null>(null);
  const list = useQuery({ queryKey: ['invoices', status, q], queryFn: () => get<{ items: Invoice[] }>('/invoices', { status, q }) });
  const items = list.data?.items ?? [];
  const [tplOpen, setTplOpen] = useState(false);
  const templates = useQuery({ queryKey: ['invoice-templates'], queryFn: () => get<{ items: InvoiceTemplate[] }>('/invoice-templates'), enabled: tplOpen });
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); invalidate(); toast(msg); } catch (e) { toast((e as Error).message, 'error'); } };

  const sum = (s: (i: Invoice) => boolean) => items.filter(s).reduce((a, i) => a + i.total, 0);

  return (
    <Box>
      <PageHeader title="Invoices" subtitle="Create, track and download invoices. Generate one from completed jobs in a date range."
        actions={<>
          <Button startIcon={<BookmarksOutlinedIcon />} onClick={() => setTplOpen(true)}>Templates</Button>
          <Button startIcon={<UploadFileIcon />} onClick={() => nav('/documents?upload=invoice')}>Upload invoice</Button>
          <Button startIcon={<AutoAwesomeIcon />} variant="outlined" onClick={() => nav('/invoices/new?generate=1')}>Generate from jobs</Button>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => nav('/invoices/new')}>New invoice</Button>
        </>} />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Outstanding" value={money(sum((i) => i.effectiveStatus === 'sent' || i.effectiveStatus === 'overdue'))} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Overdue" value={money(sum((i) => i.effectiveStatus === 'overdue'))} tone={items.some((i) => i.effectiveStatus === 'overdue') ? 'negative' : 'neutral'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Paid" value={money(sum((i) => i.status === 'paid'))} tone="positive" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Drafts" value={items.filter((i) => i.status === 'draft').length} /></Grid>
      </Grid>
      <Card sx={{ mb: 2, p: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField placeholder="Search number, client, item…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ maxWidth: { sm: 320 } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ maxWidth: { sm: 200 } }}>
            <MenuItem value="">All</MenuItem>
            {['draft', 'sent', 'overdue', 'unpaid', 'paid', 'cancelled'].map((s) => <MenuItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</MenuItem>)}
          </TextField>
        </Stack>
      </Card>
      <Card>
        {list.isLoading ? <Box sx={{ p: 2 }}><LoadingBlock /></Box> : list.error ? <Box sx={{ p: 2 }}><ErrorBlock error={list.error} /></Box> : !items.length ? (
          <EmptyState title="No invoices yet" message="Generate an invoice from your completed jobs for any date range." action={<Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={() => nav('/invoices/new?generate=1')}>Generate from jobs</Button>} />
        ) : (
          <TableContainer>
            <Table size="small">
              {!mobile && <TableHead><TableRow><TableCell>Number</TableCell><TableCell>Client</TableCell><TableCell>Issued</TableCell><TableCell>Due</TableCell><TableCell align="right">Total</TableCell><TableCell>Status</TableCell><TableCell width={48} /></TableRow></TableHead>}
              <TableBody>
                {items.map((inv) => (
                  <TableRow key={inv.id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/invoices/${inv.id}`)}>
                    {mobile ? (
                      <TableCell>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Box><Typography variant="body2" fontWeight={600}>{inv.number} · {inv.clientName}</Typography><Typography variant="caption" color="text.secondary">{inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : 'No due date'}</Typography></Box>
                          <Box sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight={600}>{money(inv.total)}</Typography><StatusChip status={inv.effectiveStatus} /></Box>
                        </Stack>
                      </TableCell>
                    ) : (<>
                      <TableCell><Typography variant="body2" fontWeight={600}>{inv.number}</Typography></TableCell>
                      <TableCell>{inv.clientName}{inv.billToType === 'contractor' && <Chip size="small" label="Contractor" variant="outlined" color="secondary" sx={{ ml: 1 }} />}</TableCell>
                      <TableCell>{fmtDate(inv.issueDate)}</TableCell>
                      <TableCell>{fmtDate(inv.dueDate)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(inv.total)}</TableCell>
                      <TableCell><StatusChip status={inv.effectiveStatus} /></TableCell>
                    </>)}
                    <TableCell onClick={(e) => e.stopPropagation()} width={48}><IconButton size="small" aria-label="Invoice actions" onClick={(e) => setMenu({ el: e.currentTarget, inv })}><MoreVertIcon fontSize="small" /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="pdf" component="a" href={fileUrl(`/invoices/${menu.inv.id}/pdf`, { download: 1 })} onClick={() => setMenu(null)}><ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>Download PDF</MenuItem>,
          menu.inv.status === 'draft' && <MenuItem key="sent" onClick={() => { const i = menu.inv; setMenu(null); run(() => setInvoiceStatus(i, 'sent'), 'Marked as sent'); }}><ListItemIcon><SendOutlinedIcon fontSize="small" /></ListItemIcon>Mark as sent</MenuItem>,
          menu.inv.status !== 'paid' && <MenuItem key="paid" onClick={() => { const i = menu.inv; setMenu(null); run(() => markInvoicePaid(i, confirm), 'Marked as paid — its jobs and their income are marked paid too'); }}><ListItemIcon><CheckCircleOutlineIcon fontSize="small" /></ListItemIcon>Mark as paid</MenuItem>,
          menu.inv.status === 'paid' && <MenuItem key="unpaid" onClick={() => { const i = menu.inv; setMenu(null); run(() => setInvoiceStatus(i, 'sent', true), 'Marked as unpaid'); }}><ListItemIcon><SendOutlinedIcon fontSize="small" /></ListItemIcon>Mark as unpaid</MenuItem>,
          <MenuItem key="dup" onClick={() => { const i = menu.inv; setMenu(null); run(async () => { const c = await post<Invoice>(`/invoices/${i.id}/duplicate`); nav(`/invoices/${c.id}`); }, 'Invoice duplicated'); }}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>Duplicate</MenuItem>,
          <Divider key="d" />,
          <MenuItem key="del" sx={{ color: 'error.main' }} onClick={async () => { const i = menu.inv; setMenu(null); if (await confirm({ title: `Delete invoice ${i.number}?`, message: 'Linked jobs become available to invoice again. This cannot be undone.', confirmText: 'Delete' })) run(() => del(`/invoices/${i.id}`), 'Invoice deleted'); }}><ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>Delete</MenuItem>,
        ]}
      </Menu>
      <Dialog open={tplOpen} onClose={() => setTplOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Invoice templates</DialogTitle>
        <DialogContent dividers>
          {!templates.data?.items.length ? (
            <Typography variant="body2" color="text.secondary">No templates yet. Open any invoice (or start a new one), fill in the details you reuse, then choose <b>Templates → Save current as template</b>.</Typography>
          ) : (
            <List dense disablePadding>
              {templates.data.items.map((t, i) => (
                <Box key={t.id}>
                  {i > 0 && <Divider component="li" />}
                  <ListItem disableGutters secondaryAction={<Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" onClick={() => nav(`/invoices/new?template=${t.id}`)}>Use</Button>
                    <IconButton size="small" aria-label={`Delete ${t.name}`} onClick={async () => { if (await confirm({ title: `Delete template "${t.name}"?`, confirmText: 'Delete' })) run(async () => { await del(`/invoice-templates/${t.id}`); await templates.refetch(); }, 'Template deleted'); }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Stack>}>
                    <ListItemText sx={{ pr: 14 }} primary={t.name}
                      secondary={[t.clientName && `${t.billToType === 'contractor' ? 'Contractor' : 'Client'}: ${t.clientName}`, t.items?.length ? `${t.items.length} item(s) · ${money(t.items.reduce((a, x) => a + x.quantity * x.rate, 0))}` : null, t.paymentTermsDays !== undefined && t.paymentTermsDays !== null ? `${t.paymentTermsDays}-day terms` : null].filter(Boolean).join(' · ')} />
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTplOpen(false)}>Close</Button>
          <Button variant="outlined" onClick={() => nav('/invoices/new')}>New invoice</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
