import { createTheme, alpha, type PaletteMode } from '@mui/material/styles';

/** Validated categorical chart palette (fixed order, light & dark steps). */
export const CHART = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export function buildTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#818cf8' : '#4f46e5' },
      secondary: { main: dark ? '#2dd4bf' : '#0d9488' },
      success: { main: dark ? '#4ade80' : '#16a34a' },
      warning: { main: dark ? '#fbbf24' : '#d97706' },
      error: { main: dark ? '#f87171' : '#dc2626' },
      background: { default: dark ? '#0f1115' : '#f6f7f9', paper: dark ? '#171a21' : '#ffffff' },
      divider: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
      text: { primary: dark ? '#f3f4f6' : '#0f172a', secondary: dark ? '#9ca3af' : '#64748b' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h4: { fontWeight: 700, letterSpacing: -0.5 },
      h5: { fontWeight: 700, letterSpacing: -0.3 },
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: ({ theme }) => ({ borderColor: theme.palette.divider, backgroundImage: 'none' }) },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10 } } },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiFormControl: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiTableCell: { styleOverrides: { head: ({ theme }) => ({ fontWeight: 600, color: theme.palette.text.secondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }) } },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            '&.active': { backgroundColor: alpha(theme.palette.primary.main, dark ? 0.18 : 0.1), color: theme.palette.primary.main, '& .MuiListItemIcon-root': { color: theme.palette.primary.main } },
          }),
        },
      },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    },
  });
}
