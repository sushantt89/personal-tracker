import { findDate } from '../parser/dates.js';

/**
 * Turns raw receipt text (from OCR or a PDF's text layer) into suggested expense fields.
 * Pure and unit-tested. Everything it returns is a suggestion for the user to review.
 */
export interface ReceiptItem { description: string; amount: number }
export interface ReceiptFields {
  merchant?: string;
  abn?: string;
  date?: string;
  total?: number;
  gst?: number;
  paymentMethod?: string;
  categoryHint?: string;
  items: ReceiptItem[];
  warnings: string[];
}

const BRANDS: [RegExp, string, string][] = [
  [/woolworths|woolies/i, 'Woolworths', 'Groceries'], [/\bcoles\b/i, 'Coles', 'Groceries'], [/\baldi\b/i, 'ALDI', 'Groceries'], [/\biga\b/i, 'IGA', 'Groceries'],
  [/foodland/i, 'Foodland', 'Groceries'], [/drakes/i, 'Drakes', 'Groceries'], [/harris\s*farm/i, 'Harris Farm', 'Groceries'], [/costco/i, 'Costco', 'Groceries'],
  [/\bshell\b/i, 'Shell', 'Fuel'], [/\bbp\b/i, 'BP', 'Fuel'], [/ampol/i, 'Ampol', 'Fuel'], [/caltex/i, 'Caltex', 'Fuel'], [/7[\s-]?eleven/i, '7-Eleven', 'Fuel'],
  [/\botr\b|on the run/i, 'OTR', 'Fuel'], [/united petroleum|\bunited\b.*fuel/i, 'United Petroleum', 'Fuel'], [/\bpuma\b/i, 'Puma Energy', 'Fuel'], [/liberty/i, 'Liberty', 'Fuel'],
  [/mcdonald/i, "McDonald's", 'Food'], [/\bkfc\b/i, 'KFC', 'Food'], [/hungry\s*jack/i, "Hungry Jack's", 'Food'], [/subway/i, 'Subway', 'Food'], [/domino/i, "Domino's", 'Food'],
  [/grill'?d/i, "Grill'd", 'Food'], [/guzman/i, 'Guzman y Gomez', 'Food'], [/oporto/i, 'Oporto', 'Food'], [/red rooster/i, 'Red Rooster', 'Food'], [/uber\s*eats/i, 'Uber Eats', 'Food'],
  [/bunnings/i, 'Bunnings', 'Shopping'], [/\bkmart\b/i, 'Kmart', 'Shopping'], [/\btarget\b/i, 'Target', 'Shopping'], [/big\s*w\b/i, 'BIG W', 'Shopping'],
  [/jb\s*hi[\s-]?fi/i, 'JB Hi-Fi', 'Shopping'], [/officeworks/i, 'Officeworks', 'Shopping'], [/harvey\s*norman/i, 'Harvey Norman', 'Shopping'], [/chemist\s*warehouse/i, 'Chemist Warehouse', 'Shopping'],
  [/priceline/i, 'Priceline', 'Shopping'], [/telstra/i, 'Telstra', 'Phone'], [/optus/i, 'Optus', 'Phone'], [/vodafone/i, 'Vodafone', 'Phone'], [/\bagl\b/i, 'AGL', 'Utilities'],
  [/origin energy/i, 'Origin Energy', 'Utilities'], [/sa water/i, 'SA Water', 'Utilities'], [/spotify/i, 'Spotify', 'Subscriptions'], [/netflix/i, 'Netflix', 'Subscriptions'],
  [/hoyts/i, 'Hoyts', 'Entertainment'], [/event cinemas/i, 'Event Cinemas', 'Entertainment'], [/repco/i, 'Repco', 'Car'], [/supercheap/i, 'Supercheap Auto', 'Car'],
  [/\buber\b(?!\s*eats)/i, 'Uber', 'Transport'], [/adelaide metro|metrocard/i, 'Adelaide Metro', 'Transport'], [/dan murphy/i, "Dan Murphy's", 'Food'], [/\bbws\b/i, 'BWS', 'Food'],
];
const CATEGORY_WORDS: [RegExp, string][] = [
  [/unleaded|diesel|\be10\b|\bu91\b|\bu95\b|\bu98\b|premium 9[58]|pump\s*\d|litres?|\bltr?s?\b/i, 'Fuel'],
  [/cafe|coffee|latte|cappuccino|restaurant|pizza|burger|kebab|sushi|bakery|takeaway/i, 'Food'],
  [/parking|car park|taxi|toll/i, 'Transport'],
  [/mechanic|service centre|tyres?|rego|registration/i, 'Car'],
  [/university|textbook|tuition/i, 'Education'],
  [/pharmacy|chemist/i, 'Shopping'],
];

const MONEY_RE = /(?<![\d.,])\$?\s?(\d{1,5}(?:,\d{3})?[.,]\d{2})(?!\d)/g;

/** Fix typical OCR confusions inside numbers: O→0, l/I→1, S→5 next to digits. */
function cleanNumbers(line: string): string {
  return line
    .replace(/(?<=\d)[oO](?=[\d.,]|$)|(?<=[\d.,])[oO](?=\d|\b)/g, '0')
    .replace(/(?<=\d)[lI|](?=[\d.,])|(?<=[.,]\d?)[lI|]/g, '1')
    .replace(/(\d)\s+([.,])\s*(\d{2})\b/g, '$1$2$3');
}

function amounts(line: string): number[] {
  const out: number[] = [];
  for (const m of cleanNumbers(line).matchAll(MONEY_RE)) {
    const raw = m[1].replace(/,(?=\d{3})/g, '').replace(',', '.');
    const n = Number(raw);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Tolerant keyword matching: OCR often reads TOTAL as T0TAL / TOTA1
const isTotalWord = (l: string) => /\bt[o0]ta[l1i]\b/.test(l);
const NOT_TOTAL = /sub\s*t[o0]ta[l1]|subt[o0]ta[l1]|t[o0]ta[l1]\s*(?:gst|tax|savings?|saved|discount|items?|qty|quantity|points?)|(?:gst|tax)\s*t[o0]ta[l1]|includes?\s*gst|items?\s*sold/;
const EXCLUDE_FALLBACK = /cash|tender|change|rounding|refund|points|savings|saved|discount|balance\s*remaining|account|card\s*no|auth|ref\b|terminal|merchant\s*id|stan|rrn/;

export function parseReceiptText(text: string, today: string): ReceiptFields {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lower = lines.map(norm);
  const all = lines.join('\n');
  const res: ReceiptFields = { items: [], warnings: [] };

  // ---- Merchant & category
  for (const [re, name, cat] of BRANDS) {
    if (re.test(all)) {
      res.merchant = name;
      res.categoryHint = cat;
      break;
    }
  }
  if (!res.merchant) {
    const skip = /tax\s*invoice|receipt|\babn\b|\bacn\b|phone|\bph\b|tel\b|www|http|@|welcome|thank|invoice|date|time|order|table|server|cashier|operator|store\s*\d|^\d|\d{4,}/i;
    const cand = lines.slice(0, 6).find((l) => /[a-z]{3,}/i.test(l) && !skip.test(l) && l.replace(/[^a-z]/gi, '').length >= 3 && l.length <= 40);
    if (cand) res.merchant = cand.replace(/^[^a-z0-9]+|[^a-z0-9)'.]+$/gi, '').replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
  }
  if (!res.categoryHint) for (const [re, cat] of CATEGORY_WORDS) if (re.test(all)) { res.categoryHint = cat; break; }

  // ---- ABN
  const abn = /\bA\.?B\.?N\.?[:\s#]*((?:\d\s?){11})/i.exec(all);
  if (abn) res.abn = abn[1].replace(/\s/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

  // ---- Date (must be plausible: not in the future, within 2 years)
  const earliest = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  for (const l of lines) {
    const dash = /\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/.exec(l);
    const candidate = findDate(dash ? l.replace(dash[0], `${dash[1]}/${dash[2]}/${dash[3]}`) : cleanNumbers(l), today)?.date;
    if (candidate && candidate <= today && candidate >= earliest && !/(expir|valid until|best before|use by)/i.test(l)) {
      res.date = candidate;
      break;
    }
  }

  // ---- Total: score labelled lines, fall back to the largest sensible amount
  type Cand = { amount: number; score: number; idx: number };
  const cands: Cand[] = [];
  lower.forEach((l, i) => {
    let score = 0;
    if (/grand\s*t[o0]ta[l1]/.test(l)) score = 100;
    else if (/(amount|balance|total)\s*(due|payable|owing)|to\s*pay\b/.test(l)) score = 90;
    else if (isTotalWord(l) && !NOT_TOTAL.test(l)) score = 80;
    else if (/\b(eftpos|visa|mastercard|master card|amex|debit|credit|purchase|card)\b/.test(l) && !/surcharge|fee/.test(l)) score = 50;
    else if (/\bamount\b/.test(l)) score = 40;
    if (!score) return;
    let a = amounts(lines[i]);
    if (!a.length && lines[i + 1]) a = amounts(lines[i + 1]);
    if (a.length) cands.push({ amount: a[a.length - 1], score, idx: i });
  });
  cands.sort((x, y) => y.score - x.score || y.amount - x.amount || y.idx - x.idx);
  if (cands.length) res.total = cands[0].amount;
  else {
    const pool = lines.filter((_, i) => !EXCLUDE_FALLBACK.test(lower[i])).flatMap(amounts).filter((n) => n > 0 && n < 100000);
    if (pool.length) {
      res.total = Math.max(...pool);
      res.warnings.push('Total was not labelled clearly — used the largest amount. Please check it.');
    }
  }
  if (res.total === undefined) res.warnings.push('No total found — please enter the amount.');

  // ---- GST
  lower.forEach((l, i) => {
    if (res.gst !== undefined) return;
    if (/\bg\s?s\s?t\b|\bgst\b|\btax\b/.test(l) && !/tax\s*invoice|gst\s*(free|exempt)|\babn\b|registered/.test(l)) {
      let a = amounts(lines[i]);
      if (!a.length && lines[i + 1] && !/[a-z]{4,}/i.test(lines[i + 1])) a = amounts(lines[i + 1]);
      const plausible = a.filter((n) => res.total === undefined || n <= res.total * 0.15 + 0.01);
      if (plausible.length) res.gst = plausible[plausible.length - 1];
    }
  });

  // ---- Payment method
  if (/\b(visa|mastercard|master card|amex|american express|eftpos|debit|credit|paywave|tap|apple pay|google pay|contactless)\b/i.test(all)) res.paymentMethod = 'Card';
  else if (/\bcash\b/i.test(all)) res.paymentMethod = 'Cash';

  // ---- Line items: "description ... 12.34" above the total line
  const stopAt = cands.length ? Math.min(...cands.filter((c) => c.score >= 80).map((c) => c.idx), lines.length) : lines.length;
  for (let i = 0; i < stopAt && res.items.length < 40; i++) {
    const l = lower[i];
    if (/t[o0]ta[l1]|gst|\btax\b|change|cash|eftpos|visa|mastercard|balance|rounding|saving|discount|abn|invoice|date|time|phone|tel\b/.test(l)) continue;
    const a = amounts(lines[i]);
    const desc = cleanNumbers(lines[i]).replace(MONEY_RE, ' ').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
    if (a.length && /[a-z]{3,}/i.test(desc) && desc.length <= 60) res.items.push({ description: desc.replace(/^[\d\sx@.]+(?=[a-z])/i, '').trim() || desc, amount: a[a.length - 1] });
  }
  return res;
}
