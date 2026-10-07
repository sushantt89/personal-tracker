import { post } from '../api/client';
import type { Invoice } from '../api/types';

type Confirm = (o: { title: string; message?: string; confirmText?: string }) => Promise<boolean>;

/** Marks an invoice paid. The jobs on it, and their income, are marked paid with it. */
export async function markInvoicePaid(inv: Invoice, _confirm?: Confirm) {
  return post<{ incomeUpdated: number; jobsUpdated: number }>(`/invoices/${inv.id}/status`, { status: 'paid' });
}

export const setInvoiceStatus = (inv: Invoice, status: 'draft' | 'sent' | 'cancelled', updateIncome = status === 'sent') => post(`/invoices/${inv.id}/status`, { status, updateIncome });

/** Emails the invoice PDF straight to the address saved in Clients & contractors — subject and message are filled in by the server. */
export interface SentInvoice { to: string; via: 'gmail' | 'smtp'; from: string | null; googleError: string | null }
export const sendInvoice = (inv: Invoice) => post<SentInvoice>(`/invoices/${inv.id}/send`, {});
/** Invoices always go out from the user's own Google account. */
export const sentMessage = (inv: Invoice, r: SentInvoice): { text: string; severity: 'success' } =>
  ({ text: `Invoice ${inv.number} sent to ${r.to} from ${r.from ?? 'your Google account'} — it's in your Gmail Sent folder`, severity: 'success' });
