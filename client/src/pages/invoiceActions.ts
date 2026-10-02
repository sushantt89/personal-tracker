import { post } from '../api/client';
import type { Invoice } from '../api/types';

type Confirm = (o: { title: string; message?: string; confirmText?: string }) => Promise<boolean>;

/** Marks an invoice paid; asks whether linked income records should be marked paid too. */
export async function markInvoicePaid(inv: Invoice, confirm: Confirm) {
  const linked = inv.items.filter((i) => i.jobId).length;
  let updateIncome = false;
  if (linked) {
    updateIncome = await confirm({ title: 'Also mark linked income as paid?', message: `${linked} job income record(s) are linked to ${inv.number}. Mark them paid as well?`, confirmText: 'Yes, mark paid' });
  }
  return post<{ incomeUpdated: number }>(`/invoices/${inv.id}/status`, { status: 'paid', updateIncome });
}

export const setInvoiceStatus = (inv: Invoice, status: 'draft' | 'sent' | 'cancelled', updateIncome = status === 'sent') => post(`/invoices/${inv.id}/status`, { status, updateIncome });
