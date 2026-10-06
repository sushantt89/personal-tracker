import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, AppBar, IconButton, Typography, Stack, Avatar, Menu, MenuItem,
  Tooltip, useMediaQuery, useTheme, Divider, Button, ListSubheader, ListItemIcon as MenuIcon, Paper, ButtonBase, Fab,
} from '@mui/material';
import MenuIcon2 from '@mui/icons-material/Menu';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import AddIcon from '@mui/icons-material/Add';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { NAV } from './nav';
import GlobalSearch from './GlobalSearch';
import AlertsMenu from './AlertsMenu';
import QuickAdd from './QuickAdd';
import AlertPopups from '../notifications/AlertPopups';
import { InstallBanner, useInstallAction } from '../components/InstallApp';
import { useAuth } from '../hooks/useAuth';
import { useThemeMode, type ThemePref } from '../theme/ThemeModeProvider';
import { patch } from '../api/client';

const WIDTH = 248;
const RAIL = 72;
const BOTTOM_BAR = 60;
const SAFE_TOP = 'env(safe-area-inset-top)';
const SAFE_BOTTOM = 'env(safe-area-inset-bottom)';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" justifyContent={compact ? 'center' : 'flex-start'} sx={{ px: compact ? 0 : 2.5, height: 64, flexShrink: 0 }}>
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: 30, height: 30 }} />
      {!compact && <Typography variant="subtitle1" fontWeight={700} letterSpacing={-0.3}>Personal Tracker</Typography>}
    </Stack>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export default function AppLayout() {
  const theme = useTheme();
  // phone: bottom bar · tablet portrait: slide-out menu · tablet landscape / small laptop: icon rail · desktop: full sidebar
  const desktop = useMediaQuery(theme.breakpoints.up('lg'));
  const rail = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [userEl, setUserEl] = useState<HTMLElement | null>(null);
  const { user, logout } = useAuth();
  const { pref, setPref } = useThemeMode();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const online = useOnline();
  const install = useInstallAction();
  const side = desktop ? WIDTH : rail ? RAIL : 0;

  const cycleTheme = () => {
    const next: ThemePref = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light';
    setPref(next);
    patch('/auth/me', { theme: next }).catch(() => undefined);
  };
  const themeIcon = pref === 'light' ? <LightModeOutlinedIcon /> : pref === 'dark' ? <DarkModeOutlinedIcon /> : <SettingsBrightnessOutlinedIcon />;

  const drawer = (compact: boolean) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', pt: SAFE_TOP, pl: 'env(safe-area-inset-left)' }}>
      <Brand compact={compact} />
      <Box sx={{ overflowY: 'auto', flex: 1, px: compact ? 1 : 1.5, pb: `calc(16px + ${SAFE_BOTTOM})` }}>
        {NAV.map((group, gi) => (
          <List key={gi} dense subheader={group.section && !compact ? <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>{group.section}</ListSubheader> : undefined}
            sx={compact && gi > 0 ? { borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 1 } : undefined}>
            {group.items.map((item) => {
              const button = (
                <ListItemButton key={item.to} component={NavLink} to={item.to} end={item.to === '/'} onClick={() => setMobileOpen(false)} aria-label={item.label}
                  sx={{ mb: 0.25, py: compact ? 1.1 : { xs: 1.1, lg: 0.75 }, justifyContent: compact ? 'center' : undefined }}>
                  <ListItemIcon sx={{ minWidth: compact ? 0 : 36, '& svg': { fontSize: compact ? 22 : 20 } }}>{item.icon}</ListItemIcon>
                  {!compact && <ListItemText primary={item.label} slotProps={{ primary: { fontSize: 14, fontWeight: 500 } }} />}
                </ListItemButton>
              );
              return compact ? <Tooltip key={item.to} title={item.label} placement="right">{button}</Tooltip> : button;
            })}
          </List>
        ))}
      </Box>
    </Box>
  );

  const tabs = [
    { to: '/', label: 'Today', icon: <DashboardOutlinedIcon /> },
    { to: '/my-day', label: 'My Day', icon: <TodayOutlinedIcon /> },
    null,
    { to: '/jobs', label: 'Jobs', icon: <WorkOutlineIcon /> },
  ] as const;
  const tabSx = (active: boolean) => ({ flex: 1, flexDirection: 'column', gap: 0.25, height: BOTTOM_BAR, color: active ? 'primary.main' : 'text.secondary', '& svg': { fontSize: 24 } }) as const;

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', width: `calc(100% - ${side}px)`, ml: `${side}px`, pt: SAFE_TOP }}>
        <Toolbar sx={{ gap: { xs: 0.5, sm: 1 }, minHeight: { xs: 60, sm: 64 }, pl: { xs: 'calc(8px + env(safe-area-inset-left))', sm: 3 }, pr: { xs: 'calc(8px + env(safe-area-inset-right))', sm: 3 } }}>
          {!desktop && !rail && !phone && <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><MenuIcon2 /></IconButton>}
          {phone && <Box component="img" src="/favicon.svg" alt="" sx={{ width: 28, height: 28, mx: 0.75, flexShrink: 0 }} />}
          <Box sx={{ flex: 1, display: 'flex', minWidth: 0 }}><GlobalSearch /></Box>
          <Button variant="contained" color="primary" startIcon={<ContentPasteGoIcon />} onClick={() => nav('/import')} sx={{ display: { xs: 'none', md: 'inline-flex' }, whiteSpace: 'nowrap' }}>Paste & Import</Button>
          <Tooltip title={`Theme: ${pref}`}><IconButton onClick={cycleTheme} aria-label="Toggle theme" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>{themeIcon}</IconButton></Tooltip>
          <AlertsMenu />
          <IconButton onClick={(e) => setUserEl(e.currentTarget)} aria-label="Account menu">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>{user?.name?.charAt(0).toUpperCase()}</Avatar>
          </IconButton>
          <Menu anchorEl={userEl} open={!!userEl} onClose={() => setUserEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{user?.name}</Typography>
              <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setUserEl(null); nav('/notifications'); }}><MenuIcon><NotificationsNoneIcon fontSize="small" /></MenuIcon>Notifications</MenuItem>
            <MenuItem onClick={() => { setUserEl(null); nav('/settings'); }}><MenuIcon><SettingsOutlinedIcon fontSize="small" /></MenuIcon>Settings</MenuItem>
            <MenuItem onClick={cycleTheme} sx={{ display: { sm: 'none' } }}><MenuIcon>{themeIcon}</MenuIcon>Theme: {pref}</MenuItem>
            {install.available && <MenuItem onClick={() => { setUserEl(null); install.run(); }}><MenuIcon><InstallMobileIcon fontSize="small" /></MenuIcon>Install app</MenuItem>}
            <Divider />
            <MenuItem onClick={async () => { setUserEl(null); await logout(); nav('/login'); }}><MenuIcon><LogoutIcon fontSize="small" /></MenuIcon>Log out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" aria-label="Main" sx={{ width: side, flexShrink: 0 }}>
        {desktop || rail ? (
          <Drawer variant="permanent" open sx={{ '& .MuiDrawer-paper': { width: side, boxSizing: 'border-box', borderRight: 1, borderColor: 'divider', overflowX: 'hidden' } }}>{drawer(rail)}</Drawer>
        ) : (
          <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: 'min(300px, 86vw)' } }}>{drawer(false)}</Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, width: `calc(100% - ${side}px)` }}>
        <Toolbar sx={{ minHeight: { xs: 60, sm: 64 }, mt: SAFE_TOP }} />
        {!online && (
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" role="status" sx={{ py: 0.75, px: 2, bgcolor: 'warning.main', color: 'warning.contrastText' }}>
            <CloudOffIcon fontSize="small" /><Typography variant="body2" fontWeight={600}>You’re offline — changes can’t be saved until you reconnect.</Typography>
          </Stack>
        )}
        <Box sx={{ p: { xs: 2, sm: 3 }, pl: { xs: 'calc(16px + env(safe-area-inset-left))', sm: 3 }, pr: { xs: 'calc(16px + env(safe-area-inset-right))', sm: 3 }, pb: { xs: `calc(${BOTTOM_BAR + 40}px + ${SAFE_BOTTOM})`, sm: 12 }, maxWidth: 1480, mx: 'auto' }}>
          {pathname === '/' && <InstallBanner />}
          <Outlet />
        </Box>
      </Box>

      {phone && (
        <Paper component="nav" aria-label="Quick navigation" square elevation={0}
          sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (t) => t.zIndex.appBar, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', pb: SAFE_BOTTOM, pl: 'env(safe-area-inset-left)', pr: 'env(safe-area-inset-right)' }}>
          {tabs.map((t) => t === null ? (
            <Box key="add" sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              <Fab color="primary" size="medium" aria-label="Quick add" onClick={() => setQuickOpen(true)} sx={{ boxShadow: 3, mt: -2.5 }}><AddIcon /></Fab>
            </Box>
          ) : (
            <ButtonBase key={t.to} component={NavLink} to={t.to} aria-label={t.label} sx={tabSx(t.to === '/' ? pathname === '/' : pathname.startsWith(t.to))}>
              {t.icon}<Typography sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>{t.label}</Typography>
            </ButtonBase>
          ))}
          <ButtonBase aria-label="More pages" onClick={() => setMobileOpen(true)} sx={tabSx(false)}>
            <MenuIcon2 /><Typography sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>More</Typography>
          </ButtonBase>
        </Paper>
      )}
      <QuickAdd phone={phone} sheetOpen={quickOpen} onSheetClose={() => setQuickOpen(false)} />
      <AlertPopups />
      {install.dialog}
    </Box>
  );
}
