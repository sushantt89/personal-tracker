import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SpeedDial, SpeedDialAction, SpeedDialIcon, Backdrop, SwipeableDrawer, Box, ButtonBase, Typography } from '@mui/material';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import { EntityFormDialog, type FieldDef, type Values } from '../components/EntityForm';
import { post } from '../api/client';
import { expenseFields, expenseDefaults, incomeFields, incomeDefaults, jobFields, jobDefaults, taskFields, taskDefaults, billFields, billDefaults, withFormattedAddress } from '../utils/forms';
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
  // The import page has its own sticky action bar
  const hideFab = pathname === '/import';
  return (
    <>
      {phone ? (
        <SwipeableDrawer anchor="bottom" open={sheetOpen} onClose={() => onSheetClose?.()} onOpen={() => undefined} disableSwipeToOpen
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 'calc(12px + env(safe-area-inset-bottom))' } } }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 1.5 }}>Quick add</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, p: 1.5 }}>
            {actions.map((a) => (
              <ButtonBase key={a.name} onClick={() => { onSheetClose?.(); a.run(); }} sx={{ flexDirection: 'column', gap: 0.75, py: 1.5, borderRadius: 3, color: 'text.primary', '&:active': { bgcolor: 'action.selected' } }}>
                <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main' }}>{a.icon}</Box>
                <Typography variant="caption" sx={{ lineHeight: 1.2, textAlign: 'center' }}>{a.name}</Typography>
              </ButtonBase>
            ))}
          </Box>
        </SwipeableDrawer>
      ) : !hideFab && (
        <>
          <Backdrop open={open} sx={{ zIndex: (t) => t.zIndex.speedDial - 1 }} />
          <SpeedDial ariaLabel="Quick add" icon={<SpeedDialIcon />} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
            sx={{ position: 'fixed', right: { xs: 16, md: 28 }, bottom: { xs: 16, md: 28 } }}>
            {actions.map((a) => (
              <SpeedDialAction key={a.name} icon={a.icon} slotProps={{ tooltip: { title: a.name, open: true } }} onClick={() => { setOpen(false); a.run(); }} />
            ))}
          </SpeedDial>
        </>
      )}
      {cfg && (
        <EntityFormDialog open={!!kind} title={cfg.title} fields={cfg.fields.filter((f) => f.quick)} initial={cfg.defaults()} onClose={() => setKind(null)}
          onSubmit={async (v) => {
            await post(cfg.endpoint, kind === 'job' ? withFormattedAddress(v) : v);
            invalidate();
            toast(`${cfg.title.replace('Quick ', '')} saved`);
          }} />
      )}
    </>
  );
}
