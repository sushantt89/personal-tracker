import { useRef, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const THRESHOLD = 88; // how far left a row has to be dragged before letting go counts

/**
 * A row you can swipe left on a touch screen to do one thing (e.g. mark a bill paid).
 * Dragging reveals the action behind the row; letting go past the threshold runs it, otherwise the row springs back.
 * Vertical scrolling is left alone, and a swipe never also counts as a tap.
 */
export default function SwipeAction({ children, label, onAction, disabled }: { children: ReactNode; label: string; onAction: () => void | Promise<void>; disabled?: boolean }) {
  const start = useRef<{ x: number; y: number; locked: 'x' | 'y' | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const armed = dx <= -THRESHOLD;

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || busy) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, locked: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x, my = t.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    }
    if (s.locked !== 'x') return; // the person is scrolling the page
    setDragging(true);
    setDx(Math.max(-160, Math.min(0, mx)));
  };
  const onTouchEnd = async () => {
    const wasArmed = armed && start.current?.locked === 'x';
    start.current = null;
    setDragging(false);
    if (!wasArmed) { setDx(0); return; }
    setBusy(true);
    setDx(-600); // slide the row away
    try { await onAction(); } finally { setBusy(false); setDx(0); }
  };

  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1.5 }}>
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, pr: 2, color: 'success.contrastText', bgcolor: armed || busy ? 'success.main' : 'success.light', opacity: dx < 0 ? 1 : 0, transition: 'background-color .15s' }}>
        <CheckIcon fontSize="small" />
        <Typography variant="body2" fontWeight={700}>{label}</Typography>
      </Box>
      <Box onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { start.current = null; setDragging(false); setDx(0); }}
        sx={{ position: 'relative', bgcolor: 'background.paper', transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .2s ease-out', touchAction: 'pan-y' }}>
        {children}
      </Box>
    </Box>
  );
}
