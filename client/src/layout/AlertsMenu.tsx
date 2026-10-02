import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton, Badge, Popover, Box, Typography, Tooltip, Button, Stack, SwipeableDrawer, useMediaQuery, useTheme, Divider } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useAlerts } from '../hooks/useAlerts';
import NotificationList from '../notifications/NotificationList';
import type { InboxAlert } from '../api/types';

/** Bell in the top bar. A dropdown on larger screens, a slide-up sheet on phones. */
export default function AlertsMenu() {
  const nav = useNavigate();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [el, setEl] = useState<HTMLElement | null>(null);
  const { items, unread, act } = useAlerts();
  const close = () => setEl(null);
  const open = (a: InboxAlert) => { close(); if (!a.read) act('read', { keys: [a.key] }); if (a.link) nav(a.link); };

  const body = (
    <>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.25 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Notifications{unread ? ` · ${unread} new` : ''}</Typography>
        <Button size="small" disabled={!unread} onClick={() => act('read', { all: true })}>Mark all read</Button>
      </Stack>
      <Divider />
      <Box sx={{ overflowY: 'auto', flex: 1 }}>
        <NotificationList items={items} onOpen={open} onDismiss={(a) => act('dismiss', { keys: [a.key] })} />
      </Box>
      <Divider />
      <Stack direction="row" justifyContent="space-between" sx={{ px: 1, py: 0.75 }}>
        <Button size="small" onClick={() => { close(); nav('/notifications'); }}>See all</Button>
        <Button size="small" color="inherit" onClick={() => { close(); nav('/settings?tab=notifications'); }}>Notification settings</Button>
      </Stack>
    </>
  );

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setEl(e.currentTarget)} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
          <Badge badgeContent={unread} color="error" max={99}><NotificationsNoneIcon /></Badge>
        </IconButton>
      </Tooltip>
      {phone ? (
        <SwipeableDrawer anchor="bottom" open={!!el} onClose={close} onOpen={() => undefined} disableSwipeToOpen
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85dvh', display: 'flex', flexDirection: 'column', pb: 'env(safe-area-inset-bottom)' } } }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
          {body}
        </SwipeableDrawer>
      ) : (
        <Popover open={!!el} anchorEl={el} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { width: 400, maxHeight: 'min(560px, calc(100dvh - 96px))', display: 'flex', flexDirection: 'column' } } }}>
          {body}
        </Popover>
      )}
    </>
  );
}
