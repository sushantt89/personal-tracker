import { post, fileUrl } from '../api/client';
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

/**
 * Hands the invoice PDF to the device's share sheet (WhatsApp, Messages, email apps…).
 * Where the browser can't share files — most desktop browsers — the PDF is downloaded instead so it can be attached by hand.
 * Returns what happened; 'cancelled' means the person closed the share sheet.
 */
export async function shareInvoicePdf(inv: Invoice): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const res = await fetch(fileUrl(`/invoices/${inv.id}/pdf`), { credentials: 'include' });
  if (!res.ok) throw new Error('The invoice PDF could not be loaded. Try again.');
  const name = `${inv.number.replace(/[^\w.-]/g, '_')}.pdf`;
  const file = new File([await res.blob()], name, { type: 'application/pdf' });
  const data: ShareData = { files: [file], title: `Invoice ${inv.number}` };
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try { await navigator.share(data); return 'shared'; }
    catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Some browsers refuse once the tap is "too old" (the PDF took a while to load): fall through to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
