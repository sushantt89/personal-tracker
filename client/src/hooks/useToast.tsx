import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Snackbar, Alert } from '@mui/material';

type Severity = 'success' | 'error' | 'info' | 'warning';
const Ctx = createContext<(msg: string, severity?: Severity) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ msg: string; severity: Severity; key: number } | null>(null);
  const toast = useCallback((msg: string, severity: Severity = 'success') => setState({ msg, severity, key: Date.now() }), []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <Snackbar key={state?.key} open={!!state} autoHideDuration={state?.severity === 'error' ? 8000 : 3500} onClose={() => setState(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 'calc(76px + env(safe-area-inset-bottom))', sm: 24 } }}>
        <Alert onClose={() => setState(null)} severity={state?.severity ?? 'info'} variant="filled" sx={{ width: '100%', maxWidth: 560 }}>
          {state?.msg}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
