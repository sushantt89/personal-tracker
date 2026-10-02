import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeModeProvider } from './theme/ThemeModeProvider';
import { ToastProvider } from './hooks/useToast';
import { ConfirmProvider } from './components/common';
import { initInstall } from './utils/install';

initInstall();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (count, err) => count < 1 && (err as { status?: number })?.status !== 401, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
