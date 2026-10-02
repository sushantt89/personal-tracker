import PDFDocument from 'pdfkit';
import { Invoice, Settings } from '../models/index.js';
import { round2 } from '../utils/money.js';

export function formatInvoiceNumber(format: string, seq: number, date: string): string {
  return format
    .replace(/\{YYYY\}/g, date.slice(0, 4))
    .replace(/\{YY\}/g, date.slice(2, 4))
    .replace(/\{MM\}/g, date.slice(5, 7))
    .replace(/\{SEQ(?::(\d))?\}/g, (_, w) => String(seq).padStart(w ? Number(w) : 4, '0'));
}

/** Reserves the next unused invoice number for a user (atomic counter + uniqueness check). */
export async function nextInvoiceNumber(userId: string, issueDate: string, reserve = true): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const s = reserve
      ? await Settings.findOneAndUpdate({ userId }, { $inc: { 'invoice.nextSequence': 1 } }, { new: false, upsert: true })
      : await Settings.findOne({ userId });
    const seq = (s?.invoice?.nextSequence ?? 1) + (reserve ? 0 : attempt);
    const number = formatInvoiceNumber(s?.invoice?.numberFormat || 'INV-{YYYY}-{SEQ}', seq, issueDate);
    if (!(await Invoice.exists({ userId, number }))) return number;
  }
  throw new Error('Could not allocate an invoice number');
}

export interface ItemInput {
  quantity: number;
  rate: number;
  amount?: number;
}

export function computeTotals(items: ItemInput[], gstRate: number) {
  const lines = items.map((i) => round2((i.quantity ?? 1) * i.rate));
  const subtotal = round2(lines.reduce((a, b) => a + b, 0));
  const gstAmount = round2((subtotal * (gstRate || 0)) / 100);
  return { lines, subtotal, gstAmount, total: round2(subtotal + gstAmount) };
}

export function effectiveStatus(inv: { status: string; dueDate: string }, today: string) {
  return inv.status === 'sent' && inv.dueDate < today ? 'overdue' : inv.status;
}

const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format(n || 0);
const fmtDate = (s?: string | null) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Renders an invoice to a PDF buffer. */
export async function renderInvoicePdf(invoice: any, settings: any, currency: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${invoice.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const biz = settings?.invoice ?? {};
  const accent = '#4f46e5';
  const muted = '#6b7280';
  const left = 50, right = 545;

  // Logo
  let headerY = 50;
  if (typeof biz.logoDataUrl === 'string' && /^data:image\/(png|jpe?g);base64,/.test(biz.logoDataUrl)) {
    try {
      const buf = Buffer.from(biz.logoDataUrl.split(',')[1], 'base64');
      doc.image(buf, left, headerY, { fit: [80, 60] });
      headerY += 0;
    } catch { /* ignore bad logo */ }
  }

  doc.fillColor(accent).fontSize(26).font('Helvetica-Bold').text('INVOICE', 300, headerY, { width: right - 300, align: 'right' });
  doc.fillColor('#111827').fontSize(10).font('Helvetica');
  doc.text(`Invoice #: ${invoice.number}`, 300, headerY + 34, { width: right - 300, align: 'right' });
  doc.text(`Issue date: ${fmtDate(invoice.issueDate)}`, { width: right - 300, align: 'right' });
  doc.text(`Due date: ${fmtDate(invoice.dueDate)}`, { width: right - 300, align: 'right' });
  if (invoice.periodFrom && invoice.periodTo) doc.text(`Period: ${fmtDate(invoice.periodFrom)} – ${fmtDate(invoice.periodTo)}`, { width: right - 300, align: 'right' });

  const fromX = left, fromY = headerY + 70;
  doc.font('Helvetica-Bold').fontSize(11).text(biz.businessName || 'Your name', fromX, fromY, { width: 240 });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (biz.abn) doc.text(`ABN: ${biz.abn}`, { width: 240 });
  if (biz.address) doc.text(biz.address, { width: 240 });
  if (biz.email) doc.text(biz.email, { width: 240 });
  if (biz.phone) doc.text(biz.phone, { width: 240 });

  doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('BILL TO', 300, fromY, { width: 245 });
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(invoice.clientName, { width: 245 });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (invoice.clientAddress) doc.text(invoice.clientAddress, { width: 245 });
  if (invoice.clientEmail) doc.text(invoice.clientEmail, { width: 245 });

  // Items table
  let y = Math.max(doc.y, fromY + 80) + 20;
  const cols = { date: left, desc: left + 75, qty: 370, rate: 420, amount: 480 };
  doc.rect(left, y, right - left, 22).fill('#eef2ff');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
  doc.text('Date', cols.date + 6, y + 7);
  doc.text('Description', cols.desc, y + 7);
  doc.text('Qty', cols.qty, y + 7, { width: 40, align: 'right' });
  doc.text('Rate', cols.rate, y + 7, { width: 55, align: 'right' });
  doc.text('Amount', cols.amount, y + 7, { width: right - cols.amount - 6, align: 'right' });
  y += 28;
  doc.font('Helvetica').fontSize(9);
  for (const item of invoice.items ?? []) {
    const h = Math.max(doc.heightOfString(item.description, { width: cols.qty - cols.desc - 10 }), 12);
    if (y + h > 740) {
      doc.addPage();
      y = 50;
    }
    doc.fillColor('#111827');
    doc.text(fmtDate(item.date), cols.date + 6, y, { width: 70 });
    doc.text(item.description, cols.desc, y, { width: cols.qty - cols.desc - 10 });
    doc.text(String(item.quantity), cols.qty, y, { width: 40, align: 'right' });
    doc.text(fmtMoney(item.rate, currency), cols.rate, y, { width: 55, align: 'right' });
    doc.text(fmtMoney(item.amount, currency), cols.amount, y, { width: right - cols.amount - 6, align: 'right' });
    y += h + 8;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  }

  // Totals
  y += 6;
  if (y > 680) {
    doc.addPage();
    y = 50;
  }
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#111827');
    doc.text(label, 330, y, { width: 130, align: 'right' });
    doc.text(value, cols.amount - 20, y, { width: right - cols.amount + 14, align: 'right' });
    y += bold ? 22 : 16;
  };
  totalRow('Subtotal', fmtMoney(invoice.subtotal, currency));
  if (invoice.gstRate > 0) totalRow(`GST (${invoice.gstRate}%)`, fmtMoney(invoice.gstAmount, currency));
  doc.moveTo(330, y).lineTo(right, y).strokeColor(accent).lineWidth(1).stroke();
  y += 6;
  totalRow('Total due', fmtMoney(invoice.total, currency), true);

  y += 16;
  const paymentDetails = invoice.paymentDetails || biz.paymentDetails;
  if (paymentDetails) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Payment details', left, y);
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(paymentDetails, left, doc.y + 2, { width: 300 });
    y = doc.y + 12;
  }
  if (invoice.notes) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Notes', left, y);
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(invoice.notes, left, doc.y + 2, { width: right - left });
  }
  if (invoice.status === 'paid') {
    doc.save().rotate(-20, { origin: [420, 160] }).fontSize(40).fillColor('#16a34a').opacity(0.25).font('Helvetica-Bold').text('PAID', 360, 140).restore();
  }

  doc.end();
  return done;
}
