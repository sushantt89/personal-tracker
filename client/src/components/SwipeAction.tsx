import { useRef, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const THRESHOLD = 72; // how far left a row has to be dragged before letting go counts

/**
 * A row you can swipe left to do one thing (e.g. mark a bill paid) — with a finger, a mouse or a trackpad drag.
 * Dragging reveals the action behind the row; letting go past the threshold runs it, otherwise the row springs back.
 * Vertical scrolling is left alone, and a swipe never also counts as a tap on something inside the row.
 */
export default function SwipeAction({ children, label, onAction, disabled }: { children: ReactNode; label: string; onAction: () => void | Promise<void>; disabled?: boolean }) {
  const start = useRef<{ x: number; y: number; id: number; locked: 'x' | 'y' | null } | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const armed = dx <= -THRESHOLD;

  const reset = () => { start.current = null; setDragging(false); setDx(0); };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: null };
    swiped.current = false;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.locked === 'x') {
        // Keep receiving the drag even if the finger or cursor leaves the row
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported: still works while inside the row */ }
        setDragging(true);
      }
    }
    if (s.locked !== 'x') return; // the person is scrolling the page
    swiped.current = true;
    setDx(Math.max(-180, Math.min(0, mx)));
  };
  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const go = s.locked === 'x' && armed;
    start.current = null;
    setDragging(false);
    if (!go) { setDx(0); return; }
    setBusy(true);
    setDx(-700); // slide the row away
    try { await onAction(); } finally { setBusy(false); setDx(0); }
  };

  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1.5 }}>
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, pr: 2, color: 'success.contrastText', bgcolor: armed || busy ? 'success.main' : 'success.light', opacity: dx < 0 ? 1 : 0, transition: 'background-color .15s' }}>
        <CheckIcon fontSize="small" />
        <Typography variant="body2" fontWeight={700}>{label}</Typography>
      </Box>
      <Box
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={reset}
        // A drag must not also trigger a button inside the row
        onClickCapture={(e) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }}
        onDragStart={(e) => e.preventDefault()}
        sx={{ position: 'relative', bgcolor: 'background.paper', transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .2s ease-out', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', cursor: dragging ? 'grabbing' : undefined }}>
        {children}
      </Box>
    </Box>
  );
}
