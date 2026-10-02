import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography } from '@mui/material';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import IosShareIcon from '@mui/icons-material/IosShare';
import AddBoxOutlinedIcon from '@mui/icons-material/AddBoxOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useInstall } from '../utils/install';

const DISMISS_KEY = 'pt-install-dismissed';
const wasDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

export function IosInstallSteps() {
  const row = { display: 'flex', alignItems: 'center', gap: 1.25 } as const;
  return (
    <Stack spacing={1.5}>
      <Box sx={row}><IosShareIcon color="primary" /><Typography variant="body2">1. In Safari, tap the <b>Share</b> button.</Typography></Box>
      <Box sx={row}><AddBoxOutlinedIcon color="primary" /><Typography variant="body2">2. Scroll down and tap <b>Add to Home Screen</b>.</Typography></Box>
      <Box sx={row}><InstallMobileIcon color="primary" /><Typography variant="body2">3. Tap <b>Add</b>, then open the app from its new icon.</Typography></Box>
    </Stack>
  );
}

/** Shared install action: shows the browser's dialog, or the iPhone steps. */
export function useInstallAction() {
  const install = useInstall();
  const [iosOpen, setIosOpen] = useState(false);
  const available = install.canPrompt || install.iosManual;
  const run = async () => { if (install.canPrompt) await install.prompt(); else if (install.iosManual) setIosOpen(true); };
  const dialog = (
    <Dialog open={iosOpen} onClose={() => setIosOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Add to Home Screen</DialogTitle>
      <DialogContent><IosInstallSteps /></DialogContent>
      <DialogActions><Button onClick={() => setIosOpen(false)}>Got it</Button></DialogActions>
    </Dialog>
  );
  return { ...install, available, run, dialog };
}

/** One-time prompt on phones and tablets. Goes away for good once dismissed or installed. */
export function InstallBanner() {
  const { available, run, dialog } = useInstallAction();
  const [hidden, setHidden] = useState(wasDismissed);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ } };
  if (!available || hidden) return dialog;
  return (
    <>
      <Paper variant="outlined" sx={{ display: { xs: 'flex', lg: 'none' }, alignItems: 'center', gap: 1.5, p: 1.5, mb: 2, borderColor: 'primary.main' }}>
        <Box component="img" src="/icon-192.png" alt="" sx={{ width: 40, height: 40, borderRadius: 2, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">Add Personal Tracker to your Home Screen</Typography>
          <Typography variant="caption" color="text.secondary">Opens full screen like an app, with reminders.</Typography>
        </Box>
        <Button variant="contained" size="small" onClick={run} sx={{ flexShrink: 0 }}>Install</Button>
        <IconButton size="small" aria-label="Not now" onClick={dismiss}><CloseIcon fontSize="small" /></IconButton>
      </Paper>
      {dialog}
    </>
  );
}

/** Settings card content */
export function InstallSettings() {
  const { installed, canPrompt, iosManual, run, dialog } = useInstallAction();
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  return (
    <>
      {installed ? <Alert severity="success">The app is installed on this device.</Alert>
        : canPrompt ? <Button variant="contained" startIcon={<InstallMobileIcon />} onClick={run}>Install on this device</Button>
        : iosManual ? <IosInstallSteps />
        : !secure ? <Alert severity="info">Installing needs a secure address. It works on this computer at <code>localhost</code>, and on your phone once the app is live on an <code>https://</code> address.</Alert>
        : <Typography variant="body2" color="text.secondary">Open your browser’s menu and choose <b>Install app</b> or <b>Add to Home screen</b>. If you don’t see it, the app may already be installed, or this browser doesn’t support installing.</Typography>}
      {dialog}
    </>
  );
}
