import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ToggleButton, ToggleButtonGroup, Stack, Divider } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { PageHeader, LoadingBlock, ErrorBlock, useConfirm } from '../components/common';
import { useAlerts } from '../hooks/useAlerts';
import NotificationList from '../notifications/NotificationList';

export default function NotificationsPage() {
  const nav = useNavigate();
  const confirm = useConfirm();
  const { items, unread, act, isLoading, error, refetch } = useAlerts();
  const [show, setShow] = useState<'all' | 'unread'>('all');
  const shown = show === 'unread' ? items.filter((a) => !a.read) : items;
  const clearAll = async () => {
    if (await confirm({ title: 'Clear all notifications?', message: 'They are hidden until something changes — for example a bill moves from “due tomorrow” to “due today”.', confirmText: 'Clear all' })) act('dismiss', { all: true });
  };
  return (
    <>
      <PageHeader title="Notifications" subtitle={unread ? `${unread} new` : 'Nothing new'}
        actions={<>
          <Button startIcon={<DoneAllIcon />} disabled={!unread} onClick={() => act('read', { all: true })}>Mark all read</Button>
          <Button startIcon={<ClearAllIcon />} disabled={!items.length} onClick={clearAll}>Clear all</Button>
          <Button startIcon={<SettingsOutlinedIcon />} onClick={() => nav('/settings?tab=notifications')}>Settings</Button>
        </>} />
      <Card>
        <Stack direction="row" sx={{ p: 1.5 }}>
          <ToggleButtonGroup size="small" exclusive value={show} onChange={(_, v) => v && setShow(v)}>
            <ToggleButton value="all" sx={{ px: 2 }}>All ({items.length})</ToggleButton>
            <ToggleButton value="unread" sx={{ px: 2 }}>New ({unread})</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Divider />
        {isLoading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={refetch} /> : (
          <NotificationList items={shown} emptyText={show === 'unread' ? 'No new notifications.' : "You're all caught up."}
            onOpen={(a) => { if (!a.read) act('read', { keys: [a.key] }); if (a.link) nav(a.link); }}
            onDismiss={(a) => act('dismiss', { keys: [a.key] })} />
        )}
      </Card>
    </>
  );
}
