import { useQueryClient } from '@tanstack/react-query';

/** After any financial change, refresh everything derived from it. */
export function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => {
    // Routes are recalculated in the background on the server — refresh them again shortly
    setTimeout(() => { qc.invalidateQueries({ queryKey: ['travel'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }, 3000);
    return Promise.all(
      ['jobs', 'income', 'expenses', 'bills', 'tasks', 'invoices', 'dashboard', 'alerts', 'insights', 'calendar', 'clients', 'documents', 'reports', 'budget', 'bills-due', 'bills-summary', 'search', 'travel', 'assistant'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  };
}
