import { post, get, fileUrl } from '../api/client';
import type { Invoice } from '../api/types';

type Confirm = (o: { title: string; message?: string; confirmText?: string }) => Promise<boolean>;

/** Marks an invoice paid. The jobs on it, and their income, are marked paid with it. */
export async function markInvoicePaid(inv: Invoice, _confirm?: Confirm) {
  return post<{ incomeUpdated: number; jobsUpdated: number }>(`/invoices/${inv.id}/status`, { status: 'paid' });
}

export const setInvoiceStatus = (inv: Invoice, status: 'draft' | 'sent' | 'cancelled', updateIncome = status === 'sent') => post(`/invoices/${inv.id}/status`, { status, updateIncome });

/** Emails the invoice PDF straight to the address saved in Clients & contractors — subject and message are filled in by the server. */
export interface SentInvoice { to: string; via: 'gmail' | 'smtp'; from: string | null; googleError: string | null; receipts?: number }
export const sendInvoice = (inv: Invoice) => post<SentInvoice>(`/invoices/${inv.id}/send`, {});
/** Invoices always go out from the user's own Google account. */
export const sentMessage = (inv: Invoice, r: SentInvoice): { text: string; severity: 'success' } =>
  ({ text: `Invoice ${inv.number}${r.receipts ? ` and ${r.receipts} receipt${r.receipts === 1 ? '' : 's'}` : ''} sent to ${r.to} from ${r.from ?? 'your Google account'} — it's in your Gmail Sent folder`, severity: 'success' });

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
  // Parking receipts on the invoice's jobs go along with it
  const extra: File[] = [];
  try {
    const d = await get<{ receipts?: { id: string; filename: string; mimeType: string }[] }>(`/invoices/${inv.id}/send-details`);
    for (const r of d.receipts ?? []) {
      const rr = await fetch(fileUrl(`/documents/${r.id}/file`), { credentials: 'include' });
      if (rr.ok) extra.push(new File([await rr.blob()], r.filename, { type: r.mimeType }));
    }
  } catch { /* share the invoice on its own */ }
  const data: ShareData = { files: [file, ...extra], title: `Invoice ${inv.number}` };
  if (extra.length && !navigator.canShare?.(data)) data.files = [file];
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
