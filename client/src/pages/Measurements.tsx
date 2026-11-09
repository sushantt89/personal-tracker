import { Box } from '@mui/material';

/**
 * Room Measure: draw a room (square, rectangle, L-shape, 3 walls or custom), letter the walls,
 * mark doors, windows, outlets, switches, water/gas points, vents and obstacles, and get a plan
 * plus an editable drawing of every wall. The tool lives in client/public/room-measure and saves
 * to /api/room-measures (and to the device while offline).
 */
export default function Measurements() {
  return (
    <Box
      sx={{
        // fill the space between the top bar and the bottom bar, edge to edge
        mx: { xs: 'calc(-16px - env(safe-area-inset-left))', sm: -3 },
        mt: { xs: -2, sm: -3 },
        mb: { xs: 'calc(-100px - env(safe-area-inset-bottom))', sm: -12 },
      }}
    >
      <Box
        component="iframe"
        src="/room-measure/index.html?embed=tracker"
        title="Room measurements"
        allow="web-share; camera"
        sx={{
          display: 'block', width: '100%', border: 0, bgcolor: '#f4f5f7',
          height: {
            xs: 'calc(100dvh - 60px - 60px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
            sm: 'calc(100dvh - 64px - env(safe-area-inset-top))',
          },
        }}
      />
    </Box>
  );
}
