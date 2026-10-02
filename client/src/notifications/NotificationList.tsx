import { Box, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography, Stack } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import dayjs from 'dayjs';
import type { InboxAlert } from '../api/types';

export function severityIcon(s: InboxAlert['severity']) {
  return s === 'error' ? <ErrorOutlineIcon color="error" fontSize="small" /> : s === 'warning' ? <WarningAmberIcon color="warning" fontSize="small" /> : <InfoOutlinedIcon color="info" fontSize="small" />;
}

export function ago(iso: string) {
  const mins = Math.max(0, dayjs().diff(dayjs(iso), 'minute'));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.floor(mins / (60 * 24));
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

export default function NotificationList({ items, onOpen, onDismiss, emptyText = "You're all caught up." }: { items: InboxAlert[]; onOpen: (a: InboxAlert) => void; onDismiss: (a: InboxAlert) => void; emptyText?: string }) {
  if (!items.length) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 5, px: 2, color: 'text.secondary' }}>
        <NotificationsNoneIcon />
        <Typography variant="body2">{emptyText}</Typography>
      </Stack>
    );
  }
  return (
    <List disablePadding>
      {items.map((a) => (
        <ListItemButton key={a.key} onClick={() => onOpen(a)} sx={{ borderRadius: 0, alignItems: 'flex-start', gap: 0.5, py: 1.25, pr: 1, bgcolor: a.read ? undefined : 'action.hover' }}>
          <ListItemIcon sx={{ minWidth: 32, mt: 0.4 }}>{severityIcon(a.severity)}</ListItemIcon>
          <ListItemText
            primary={a.title}
            secondary={<>{a.message && <Box component="span" sx={{ display: 'block' }}>{a.message}</Box>}<Box component="span" sx={{ fontSize: 12, opacity: 0.8 }}>{ago(a.firstSeenAt)}</Box></>}
            slotProps={{ primary: { variant: 'body2', fontWeight: a.read ? 500 : 700 }, secondary: { variant: 'body2', sx: { overflowWrap: 'anywhere' } } }}
          />
          {!a.read && <Box aria-label="Unread" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1, flexShrink: 0 }} />}
          <Tooltip title="Dismiss">
            <IconButton size="small" aria-label={`Dismiss ${a.title}`} onClick={(e) => { e.stopPropagation(); onDismiss(a); }} sx={{ mt: -0.25 }}><CloseIcon fontSize="small" /></IconButton>
          </Tooltip>
        </ListItemButton>
      ))}
    </List>
  );
}
