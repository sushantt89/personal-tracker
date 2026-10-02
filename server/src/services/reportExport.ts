import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Report, Column } from './reports.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SYMBOLS: Record<string, string> = { AUD: '$', NZD: '$', USD: '$', CAD: '$', SGD: '$', GBP: '£', EUR: '€', INR: '₹', NPR: 'Rs ' };

export function groupLabel(v: any, groupBy: string): string {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}$/.test(s)) return `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  void groupBy;
  return s;
}
const prettyDate = (s: string) => groupLabel(s, 'day');

// ---------------------------------------------------------------- Excel
function numFmt(kind: Column['kind'], symbol: string) {
  switch (kind) {
    case 'money': return `"${symbol}"#,##0.00;[Red]-"${symbol}"#,##0.00`;
    case 'int': return '#,##0';
    case 'number': return '#,##0.00';
    case 'km': return '#,##0.0" km"';
    case 'date': return 'd mmm yyyy';
    default: return undefined;
  }
}
const toExcelDate = (s: string) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
const colLetter = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const ADDITIVE = new Set(['money', 'int', 'number', 'km']);
const RATIOS = new Set(['avgPerJob', 'avgPerHour', 'perKm', 'cumulative']);

function addTableSheet(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, columns: Column[], rows: Record<string, any>[], opts: { symbol: string; totals?: Record<string, number>; groupBy?: string }) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.mergeCells(1, 1, 1, Math.max(columns.length, 2));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FF312E81' } };
  ws.mergeCells(2, 1, 2, Math.max(columns.length, 2));
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };
  const header = ws.getRow(4);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FF1E1B4B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    cell.alignment = { horizontal: ADDITIVE.has(c.kind) ? 'right' : 'left', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFA5B4FC' } } };
  });
  header.height = 20;
  rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      let v = r[c.key];
      if (c.key === 'group') v = c.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? toExcelDate(String(v)) : groupLabel(v, opts.groupBy ?? '');
      else if (c.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = toExcelDate(v);
      cell.value = v === undefined || v === '' ? null : v;
      const fmt = numFmt(c.kind, opts.symbol);
      if (fmt) cell.numFmt = fmt;
    });
    if (ri % 2 === 1) row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
  });
  if (opts.totals && rows.length) {
    const tr = ws.getRow(5 + rows.length);
    const first = 5, last = 4 + rows.length;
    columns.forEach((c, ci) => {
      const cell = tr.getCell(ci + 1);
      if (ci === 0) cell.value = 'Total';
      else if (ADDITIVE.has(c.kind) && !RATIOS.has(c.key)) cell.value = { formula: `SUM(${colLetter(ci + 1)}${first}:${colLetter(ci + 1)}${last})`, result: opts.totals![c.key] ?? 0 };
      else if (opts.totals![c.key] !== undefined) cell.value = opts.totals![c.key];
      const fmt = numFmt(c.kind, opts.symbol);
      if (fmt && ci > 0) cell.numFmt = fmt;
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FF312E81' } } };
    });
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: columns.length } };
  columns.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...rows.slice(0, 500).map((r) => (c.key === 'group' ? groupLabel(r[c.key], '') : String(r[c.key] ?? '')).length));
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 3, c.kind === 'money' ? 14 : 10), 48);
  });
  return ws;
}

export async function reportsToXlsx(reports: Report[], opts: { currency: string; includeDetail?: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Personal Tracker';
  wb.created = new Date();
  const symbol = SYMBOLS[opts.currency] ?? `${opts.currency} `;
  const period = reports[0] ? `${prettyDate(reports[0].from)} – ${prettyDate(reports[0].to)}` : '';
  if (reports.length > 1) {
    // Overview sheet with the headline numbers from each report
    const t = (type: string) => reports.find((r) => r.type === type)?.totals ?? {};
    const rows = [
      { group: 'Income received', value: t('income').paid ?? 0 }, { group: 'Income expected (not yet paid)', value: t('income').expected ?? 0 },
      { group: 'Expenses', value: t('expenses').total ?? 0 }, { group: 'Net cash flow (received − expenses)', value: t('cashflow').net ?? 0 },
      { group: 'Jobs completed', value: t('work').jobs ?? 0, kind: 'int' }, { group: 'Job income', value: t('work').total ?? 0 },
      { group: 'Average per job', value: t('work').avgPerJob ?? 0 }, { group: 'Hours worked', value: t('work').hours ?? 0, kind: 'number' },
      ...(t('work').km !== undefined ? [{ group: 'Km driven', value: t('work').km, kind: 'km' }, { group: 'Fuel cost (estimated)', value: t('work').fuelCost ?? 0 }, { group: 'Income per km', value: t('work').perKm ?? 0 }] : []),
    ];
    const ws = addTableSheet(wb, 'Summary', 'Financial summary', `Period: ${period}`, [{ key: 'group', label: 'Measure', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }], rows, { symbol });
    rows.forEach((r: any, i) => { if (r.kind) ws.getRow(5 + i).getCell(2).numFmt = numFmt(r.kind, symbol)!; });
  }
  for (const r of reports) {
    addTableSheet(wb, r.title.replace(/[^\w &-]/g, ''), `${r.title} by ${r.columns[0].label.toLowerCase()}`, `Period: ${prettyDate(r.from)} – ${prettyDate(r.to)}`, r.columns, r.rows, { symbol, totals: r.totals, groupBy: r.groupBy });
    if (opts.includeDetail && r.detail.length) addTableSheet(wb, `${r.title.replace(/[^\w &-]/g, '')} detail`.slice(0, 31), `${r.title} — every record`, `Period: ${prettyDate(r.from)} – ${prettyDate(r.to)}`, r.detailColumns, r.detail, { symbol });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF
const fmtMoney = (n: number, currency: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(n || 0);
function cellText(c: Column, v: any, currency: string, groupBy: string) {
  if (v === undefined || v === null || v === '') return '';
  if (c.key === 'group') return groupLabel(v, groupBy);
  switch (c.kind) {
    case 'money': return fmtMoney(Number(v), currency);
    case 'int': return String(Math.round(Number(v)));
    case 'number': return Number(v).toFixed(2);
    case 'km': return `${Number(v).toFixed(1)} km`;
    case 'date': return prettyDate(String(v));
    default: return String(v);
  }
}

const CHART_KEY: Record<string, string> = { income: 'total', expenses: 'total', cashflow: 'net', work: 'total' };
const ACCENT = '#4f46e5', MUTED = '#64748b', INK = '#0f172a', NEG = '#dc2626';

export async function reportsToPdf(reports: Report[], opts: { currency: string; owner?: string; includeDetail?: boolean }): Promise<Buffer> {
  const wide = reports.some((r) => r.columns.length > 6);
  const doc = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: 'Personal Tracker report' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  reports.forEach((r, ri) => {
    if (ri > 0) doc.addPage();
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(18).text(`${r.title} report`, L, 40);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(`${prettyDate(r.from)} – ${prettyDate(r.to)} · grouped by ${r.columns[0].label.toLowerCase()}${opts.owner ? ` · ${opts.owner}` : ''} · generated ${prettyDate(new Date().toISOString().slice(0, 10))}`);
    doc.moveDown(0.8);

    // Headline figures
    const heads = r.columns.filter((c) => c.key !== 'group' && r.totals[c.key] !== undefined && c.kind !== 'number').slice(0, 5);
    let x = L; const y0 = doc.y; const boxW = (W - (heads.length - 1) * 8) / Math.max(heads.length, 1);
    for (const c of heads) {
      doc.roundedRect(x, y0, boxW, 44, 6).fillAndStroke('#f5f7ff', '#e0e7ff');
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(c.label.toUpperCase(), x + 8, y0 + 7, { width: boxW - 16 });
      const v = r.totals[c.key];
      doc.fillColor(c.kind === 'money' && v < 0 ? NEG : INK).font('Helvetica-Bold').fontSize(12.5).text(cellText(c, v, opts.currency, r.groupBy), x + 8, y0 + 20, { width: boxW - 16 });
      x += boxW + 8;
    }
    doc.y = y0 + 58;

    // Bar chart for period reports
    const key = CHART_KEY[r.type];
    const isPeriod = ['day', 'week', 'month', 'year'].includes(r.groupBy) || r.type === 'cashflow';
    if (isPeriod && r.rows.length > 1 && r.rows.length <= 40) {
      const chartH = 120, top = doc.y + 6, left = L + 46, cw = W - 52;
      const vals = r.rows.map((row) => Number(row[key]) || 0);
      const max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
      const zeroY = top + (max / span) * chartH;
      doc.font('Helvetica').fontSize(7).fillColor(MUTED);
      doc.text(fmtMoney(max, opts.currency), L, top - 3, { width: 42, align: 'right' });
      if (min < 0) doc.text(fmtMoney(min, opts.currency), L, top + chartH - 5, { width: 42, align: 'right' });
      doc.moveTo(left, zeroY).lineTo(left + cw, zeroY).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
      const slot = cw / vals.length, bw = Math.max(2, Math.min(28, slot * 0.62));
      vals.forEach((v, i) => {
        const h = (Math.abs(v) / span) * chartH;
        const bx = left + i * slot + (slot - bw) / 2;
        doc.rect(bx, v >= 0 ? zeroY - h : zeroY, bw, Math.max(h, 0.5)).fill(v >= 0 ? ACCENT : NEG);
        if (vals.length <= 16 || i % Math.ceil(vals.length / 16) === 0) {
          doc.fillColor(MUTED).fontSize(6.5).text(groupLabel(r.rows[i].group, r.groupBy).replace(/ \d{4}$/, ''), left + i * slot - 6, top + chartH + 4, { width: slot + 12, align: 'center' });
        }
      });
      doc.fillColor(MUTED).fontSize(7.5).text(`${r.columns.find((c) => c.key === key)?.label ?? ''} per ${r.columns[0].label.toLowerCase()}`, left, top + chartH + 16);
      doc.y = top + chartH + 34;
    }

    const table = (cols: Column[], rows: Record<string, any>[], totals?: Record<string, number>) => {
      const fixed: number[] = cols.map((c) => (c.key === 'group' || c.kind === 'text' ? 0 : c.kind === 'date' ? 62 : 64));
      const flexCount = fixed.filter((f) => f === 0).length || 1;
      const flexW = Math.max(60, (W - fixed.reduce((a, b) => a + b, 0)) / flexCount);
      const widths = fixed.map((f) => f || flexW);
      const head = () => {
        let cx = L; const ty = doc.y;
        doc.font('Helvetica-Bold').fontSize(7.5);
        const hh = Math.max(...cols.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - 6 }))) + 6;
        doc.rect(L, ty - 3, W, hh).fill('#eef2ff');
        cols.forEach((c, i) => {
          doc.fillColor('#1e1b4b').font('Helvetica-Bold').fontSize(7.5).text(c.label, cx + 3, ty, { width: widths[i] - 6, align: ADDITIVE.has(c.kind) ? 'right' : 'left' });
          cx += widths[i];
        });
        doc.y = ty + hh;
      };
      head();
      const line = (row: Record<string, any>, bold: boolean, zebra: boolean) => {
        if (doc.y > bottom()) { doc.addPage(); doc.y = 40; head(); }
        const ty = doc.y;
        if (zebra) doc.rect(L, ty - 2, W, 13).fill('#f8fafc');
        if (bold) doc.moveTo(L, ty - 3).lineTo(L + W, ty - 3).lineWidth(0.8).strokeColor(ACCENT).stroke();
        let cx = L;
        cols.forEach((c, i) => {
          const v = row[c.key];
          doc.fillColor(c.kind === 'money' && Number(v) < 0 ? NEG : INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
            .text(bold && i === 0 ? 'Total' : cellText(c, v, opts.currency, r.groupBy), cx + 3, ty, { width: widths[i] - 6, align: ADDITIVE.has(c.kind) ? 'right' : 'left', lineBreak: false, ellipsis: true });
          cx += widths[i];
        });
        doc.y = ty + 13;
      };
      rows.forEach((row, i) => line(row, false, i % 2 === 1));
      if (totals && rows.length) { doc.y += 3; line(totals, true, false); }
    };
    if (!r.rows.length) doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('No records in this period.', L, doc.y + 6);
    else table(r.columns, r.rows, r.totals);

    if (opts.includeDetail && r.detail.length) {
      doc.addPage();
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(13).text(`${r.title} — every record`, L, 40);
      doc.moveDown(0.6);
      table(r.detailColumns, r.detail.slice(0, 1500));
      if (r.detail.length > 1500) doc.fillColor(MUTED).fontSize(8).text(`… ${r.detail.length - 1500} more rows — download the Excel file for everything.`, L, doc.y + 6);
    }
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing in the footer area must not trigger a new page
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`Personal Tracker · page ${i + 1} of ${range.count}`, L, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
