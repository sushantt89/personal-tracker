import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { buildTheme, CHART } from './theme';

export type ThemePref = 'light' | 'dark' | 'system';
interface Ctx { pref: ThemePref; mode: 'light' | 'dark'; setPref: (p: ThemePref) => void; chart: string[] }
const ThemeCtx = createContext<Ctx>({ pref: 'system', mode: 'light', setPref: () => {}, chart: CHART.light });
const KEY = 'pt-theme';

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const setPref = (p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(KEY, p); } catch { /* storage unavailable */ }
  };
  useEffect(() => { document.documentElement.dataset.theme = mode; }, [mode]);
  return (
    <ThemeCtx.Provider value={{ pref, mode, setPref, chart: CHART[mode] }}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ThemeCtx.Provider>
  );
}

export const useThemeMode = () => useContext(ThemeCtx);
