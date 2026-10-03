import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, useMediaQuery, useTheme, type ButtonProps } from '@mui/material';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';

const cameraError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser (the icon beside the address bar), then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera couldn’t be opened.';
};

/**
 * "Take photo" next to any upload button.
 * On phones and tablets it opens the device camera app directly; on a computer it opens the webcam in a dialog.
 * Either way the result is handed back as an ordinary image file, exactly as if it had been uploaded.
 */
export default function CameraButton({ onPhoto, label = 'Take photo', disabled, ...btn }: { onPhoto: (file: File) => void; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  // Touch devices have a proper camera app; the browser hands the photo back through a file input
  const touch = useMediaQuery('(pointer: coarse)');
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState(false);
  const [error, setError] = useState('');

  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setReady(false); };
  const start = async () => {
    setError(''); setShot(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { stop(); return; }
      v.srcObject = stream;
      await v.play();
      setReady(true);
    } catch (e) { setError(cameraError(e)); }
  };

  useEffect(() => { if (open) start(); return stop; /* always release the camera when the dialog closes */ }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = () => {
    if (touch || !navigator.mediaDevices?.getUserMedia) inputRef.current?.click();
    else setOpen(true);
  };
  const snap = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    setShot(true);
    stop();
  };
  const use = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) { setError('The photo couldn’t be saved. Try again.'); return; }
      onPhoto(new File([blob], `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' }));
      setOpen(false);
    }, 'image/jpeg', 0.92);
  };

  return (
    <>
      <Button variant="outlined" startIcon={<PhotoCameraOutlinedIcon />} {...btn} disabled={disabled} onClick={click}>{label}</Button>
      <input ref={inputRef} type="file" hidden accept="image/*" capture="environment" aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhoto(f); }} />
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md" fullScreen={fullScreen}>
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ bgcolor: 'common.black', borderRadius: 2, overflow: 'hidden', display: error ? 'none' : 'flex', justifyContent: 'center', minHeight: 240 }}>
            <Box component="video" ref={videoRef} muted playsInline aria-label="Camera preview" sx={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', display: shot ? 'none' : 'block' }} />
            <Box component="canvas" ref={canvasRef} aria-label="Photo taken" sx={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', display: shot ? 'block' : 'none' }} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setOpen(false)}>Cancel</Button>
          {error ? <Button onClick={() => { setOpen(false); inputRef.current?.click(); }}>Choose a file instead</Button>
            : shot ? (<><Button onClick={start}>Retake</Button><Button variant="contained" onClick={use}>Use photo</Button></>)
            : <Button variant="contained" startIcon={<PhotoCameraOutlinedIcon />} onClick={snap} disabled={!ready}>Take photo</Button>}
        </DialogActions>
      </Dialog>
    </>
  );
}
