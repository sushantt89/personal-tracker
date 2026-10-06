import { post } from '../api/client';
import type { Invoice } from '../api/types';

type Confirm = (o: { title: string; message?: string; confirmText?: string }) => Promise<boolean>;

/** Marks an invoice paid. The jobs on it, and their income, are marked paid with it. */
export async function markInvoicePaid(inv: Invoice, _confirm?: Confirm) {
  return post<{ incomeUpdated: number; jobsUpdated: number }>(`/invoices/${inv.id}/status`, { status: 'paid' });
}

export const setInvoiceStatus = (inv: Invoice, status: 'draft' | 'sent' | 'cancelled', updateIncome = status === 'sent') => post(`/invoices/${inv.id}/status`, { status, updateIncome });
