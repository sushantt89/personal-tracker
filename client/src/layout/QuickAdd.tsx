import { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Fab, Popover, SwipeableDrawer, Box, ButtonBase, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import { useJobDerive } from '../hooks/useLookups';
import { EntityFormDialog, type FieldDef, type Values } from '../components/EntityForm';
import { post } from '../api/client';
import { expenseFields, expenseDefaults, incomeFields, incomeDefaults, jobFields, jobDefaults, jobFromForm, taskFields, taskDefaults, billFields, billDefaults } from '../utils/forms';
import { useToast } from '../hooks/useToast';
import { useInvalidateFinance } from '../hooks/useInvalidate';

type Kind = 'expense' | 'income' | 'job' | 'task' | 'bill';
const CONFIG: Record<Kind, { title: string; endpoint: string; fields: FieldDef[]; defaults: () => Values }> = {
  expense: { title: 'Quick expense', endpoint: '/expenses', fields: expenseFields, defaults: expenseDefaults },
  income: { title: 'Quick income', endpoint: '/income', fields: incomeFields, defaults: incomeDefaults },
  job: { title: 'Quick job', endpoint: '/jobs', fields: jobFields, defaults: jobDefaults },
  task: { title: 'Quick task', endpoint: '/tasks', fields: taskFields, defaults: () => taskDefaults() },
  bill: { title: 'Quick bill', endpoint: '/bills', fields: billFields, defaults: billDefaults },
};

/** Quick add: a floating + button on tablets and computers; on phones a sheet opened from the bottom bar. */
export default function QuickAdd({ phone = false, sheetOpen = false, onSheetClose }: { phone?: boolean; sheetOpen?: boolean; onSheetClose?: () => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const jobDerive = useJobDerive();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const cfg = kind ? CONFIG[kind] : null;
  const actions = [
    { icon: <ShoppingCartOutlinedIcon />, name: 'Expense', run: () => setKind('expense') },
    { icon: <PaymentsOutlinedIcon />, name: 'Income', run: () => setKind('income') },
    { icon: <WorkOutlineIcon />, name: 'Job', run: () => setKind('job') },
    { icon: <TaskAltIcon />, name: 'Task', run: () => setKind('task') },
    { icon: <EventRepeatOutlinedIcon />, name: 'Bill', run: () => setKind('bill') },
    { icon: <ReceiptLongOutlinedIcon />, name: 'Invoice', run: () => nav('/invoices/new') },
    { icon: <DocumentScannerOutlinedIcon />, name: 'Receipt', run: () => nav('/receipts?upload=1') },
    { icon: <ContentPasteGoIcon />, name: 'Paste & Import', run: () => nav('/import') },
  ];
  const fabRef = useRef<HTMLButtonElement>(null);
  const grid = (close: () => void) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, p: 1.5 }}>
      {actions.map((a) => (
        <ButtonBase key={a.name} onClick={() => { close(); a.run(); }} sx={{ flexDirection: 'column', justifyContent: 'flex-start', gap: 0.75, py: 1.5, borderRadius: 3, color: 'text.primary', '&:hover': { bgcolor: 'action.hover' }, '&:active': { bgcolor: 'action.selected' } }}>
          <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main' }}>{a.icon}</Box>
          <Typography variant="caption" sx={{ lineHeight: 1.2, textAlign: 'center' }}>{a.name}</Typography>
        </ButtonBase>
      ))}
    </Box>
  );
  // The import page has its own sticky action bar
  const hideFab = pathname === '/import';
  return (
    <>
      {phone ? (
        <SwipeableDrawer anchor="bottom" open={sheetOpen} onClose={() => onSheetClose?.()} onOpen={() => undefined} disableSwipeToOpen
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 'calc(12px + env(safe-area-inset-bottom))' } } }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 1.5 }}>Quick add</Typography>
          {grid(() => onSheetClose?.())}
        </SwipeableDrawer>
      ) : !hideFab && (
        <>
          <Fab ref={fabRef} color="primary" aria-label="Quick add" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            sx={{ position: 'fixed', right: { xs: 16, md: 28 }, bottom: { xs: 16, md: 28 }, zIndex: (t) => t.zIndex.speedDial }}>
            <AddIcon sx={{ transition: 'transform .2s', transform: open ? 'rotate(45deg)' : 'none' }} />
          </Fab>
          {/* A compact panel above the button: it always fits, however short the window is */}
          <Popover open={open} anchorEl={fabRef.current} onClose={() => setOpen(false)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: -1.5, width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 120px)', borderRadius: 4, border: 1, borderColor: 'divider' } } }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 1.5 }}>Quick add</Typography>
            {grid(() => setOpen(false))}
          </Popover>
        </>
      )}
      {cfg && (
        <EntityFormDialog open={!!kind} title={cfg.title} fields={cfg.fields.filter((f) => f.quick)} initial={cfg.defaults()} onClose={() => setKind(null)} derive={kind === 'job' ? jobDerive : undefined}
          onSubmit={async (v) => {
            await post(cfg.endpoint, kind === 'job' ? jobFromForm(v) : v);
            invalidate();
            toast(`${cfg.title.replace('Quick ', '')} saved`);
          }} />
      )}
    </>
  );
}
