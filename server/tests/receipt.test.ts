import { describe, it, expect } from 'vitest';
import { parseReceiptText } from '../src/services/ocr/receiptParser.js';

const TODAY = '2026-10-01';

describe('parseReceiptText', () => {
  it('reads a fuel receipt', () => {
    const r = parseReceiptText(`SHELL GOODWOOD
TAX INVOICE
ABN 46 004 610 459
29/09/2026 07:42
PUMP 4 UNLEADED E10
32.15 L @ 1.899
UNLEADED E10        61.05
TOTAL              $61.05
INCLUDES GST         5.55
VISA CONTACTLESS    61.05`, TODAY);
    expect(r).toMatchObject({ merchant: 'Shell', categoryHint: 'Fuel', date: '2026-09-29', total: 61.05, gst: 5.55, paymentMethod: 'Card', abn: '46 004 610 459' });
  });

  it('reads a supermarket receipt with subtotal, savings and cash change', () => {
    const r = parseReceiptText(`Woolworths
Goodwood Rd
Tax Invoice ABN 88 000 014 675
Bananas 1kg          3.90
Milk 2L              3.10
Bread                4.50
SUBTOTAL            11.50
Total Savings        1.00
TOTAL               11.50
CASH                20.00
CHANGE               8.50
GST included in total 0.41
Date: 30/09/26`, TODAY);
    expect(r.merchant).toBe('Woolworths');
    expect(r.categoryHint).toBe('Groceries');
    expect(r.total).toBe(11.5);
    expect(r.gst).toBe(0.41);
    expect(r.date).toBe('2026-09-30');
    expect(r.paymentMethod).toBe('Cash');
    expect(r.items.map((i) => i.description)).toEqual(['Bananas 1kg', 'Milk 2L', 'Bread']);
  });

  it('tolerates OCR noise (T0TAL, O for 0) and month-name dates', () => {
    const r = parseReceiptText(`THE CORNER CAFE
1 Oct 2026  12:03
Flat white          5.5O
Toastie            12.0O
T0TAL              17.5O
EFTPOS             17.50`, TODAY);
    expect(r.merchant).toBe('The Corner Cafe');
    expect(r.categoryHint).toBe('Food');
    expect(r.total).toBe(17.5);
    expect(r.date).toBe('2026-10-01');
  });

  it('prefers amount due, ignores future/expiry dates, and falls back with a warning', () => {
    const due = parseReceiptText('Bob\'s Plumbing\nInvoice date 15-09-2026\nLabour 120.00\nParts 45.00\nAmount Due 165.00\nCard expires 12/28', TODAY);
    expect(due.total).toBe(165);
    expect(due.date).toBe('2026-09-15');
    const fb = parseReceiptText('MARKET STALL\nApples 4.00\nHoney 12.00', TODAY);
    expect(fb.total).toBe(12);
    expect(fb.warnings[0]).toMatch(/largest amount/);
    const none = parseReceiptText('blurry nothing', TODAY);
    expect(none.total).toBeUndefined();
    expect(none.warnings).toContain('No total found — please enter the amount.');
  });
});
