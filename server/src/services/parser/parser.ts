import { findDate } from './dates.js';
import { isLocalityLine, isStreetLine, parseAddress } from './address.js';
import type { ParsedJob, ParsedPayment, ParseResult } from './types.js';

/**
 * Rule-based parser for pasted work schedules and payment messages.
 * Pure function: no I/O, never saves anything. The caller shows the result for review.
 */

// The separator is optional before am/pm, so "900am" and "1030am" read the same as "9:00am" and "10.30am"
const TIME_SRC = String.raw`(\d{1,2})(?:[:.]?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|(\d{1,2}):(\d{2})`;
const TIME_RE = new RegExp(`\\b(?:${TIME_SRC})(?![\\d/])`, 'i');
const RANGE_RE = new RegExp(`\\b(?:${TIME_SRC})\\s*(?:[-–—]|to|until|till)\\s*(?:${TIME_SRC})`, 'i');
const AMOUNT_RE = /\(?\s*(?:AUD\s*|A?\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*\)?|\b(\d+(?:\.\d{1,2})?)\s*(?:(?:dollars|bucks)\b|\$(?!\s*\d))/i;
/** A time written as a bare number between the name and the price: " - 9 (", " @ 930 $", " - 0900 (" */
const BARE_TIME_RE = /(?:\s[-–—@:]|:)\s*([01]?\d|2[0-3])([0-5]\d)?\s*(?:h|hrs?)?\s*((?:[-–—]\s*)?[(]?\s*(?:AUD|A?\$))/i;
const HOURS_RE = /\(?\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b\)?/i;
const GREETING_RE = /^(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|dear)\b[\s,!]*(.*?)[,!.]*$/i;
const MEETING_RE = /^(?:please\s+)?(?:meet(?:ing)?(?:\s+point)?|start(?:ing)?(?:\s+(?:point|location))?|pick\s*up)\s*(?:is\s+)?(?:at|:|@)?\s*(.+?)(?:\s+(?:at|@|by)\s+(\d{1,2}(?:[:.]?\d{2})?\s*(?:am|pm)))?\s*[.!]?$/i;
const PAYMENT_HINT_RE = /\b(received|paid|payment|transfer(?:red)?|deposit(?:ed)?|sent you|credited|remittance|payid|osko)\b/i;
const PHONE_RE = /(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/;

const ACTION_WORDS = [
  'dust', 'dusting', 'wipe', 'wiping', 'wipedown', 'vacuum', 'vacuuming', 'hoover', 'mop', 'mopping', 'change', 'changing',
  'clean', 'cleaning', 'iron', 'ironing', 'wash', 'washing', 'fold', 'folding', 'empty', 'emptying', 'polish', 'polishing',
  'sweep', 'sweeping', 'scrub', 'scrubbing', 'tidy', 'tidying', 'make', 'making', 'strip', 'replace', 'sanitise', 'sanitize',
  'disinfect', 'organise', 'organize', 'declutter', 'water', 'take', 'put', 'load', 'unload', 'spot', 'deep', 'oven', 'fridge',
];
/** A line that is only decoration between jobs: ******, -----, ⬇️⬇️⬇️ */
const SEPARATOR_RE = /^(?:[*\-_=~.•\s]{3,}|[\s\u2B07\u2B06\u27A1\u2B05\uFE0F\u{1F447}\u{1F53D}\u{1F53B}]+)$/u;
/** A checklist item: starts with a tick, a bullet or a dash */
const CHECK_RE = /^(?:[\u2705\u2611\u2714\u{1F5F8}\u25AA\u25CF\u2022]\uFE0F?|[-*]\s)\s*(.+)$/u;
/** Key / lock symbols mark how to get in */
const ACCESS_EMOJI_RE = /[\u{1F511}\u{1F510}\u{1F512}\u{1F513}\u{1F5DD}]/u;
const SPECIAL_RE = /\b(please|don'?t|do not|note|key|lockbox|lock|passcode|pin|code|under the mat|careful|pet|dog|cat|park|parking|gate|alarm|avoid|allerg|shoes|call|text|ring|knock|access)\b/i;
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

let counter = 0;
const tempId = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function to24h(h: number, min: number, mer?: string): string | undefined {
  let hour = h;
  if (mer) {
    const pm = mer.toLowerCase().startsWith('p');
    if (hour < 1 || hour > 12) return undefined;
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  if (hour > 23 || min > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function timeFromGroups(g: (string | undefined)[], offset: number): { time?: string; ambiguous: boolean } {
  const [h12, m12, mer, h24, m24] = g.slice(offset, offset + 5);
  if (h12) return { time: to24h(+h12, m12 ? +m12 : 0, mer), ambiguous: false };
  if (h24) {
    const h = +h24;
    // "2:30" with no am/pm in a work schedule: hours 1-6 are almost always afternoon
    const adj = h >= 1 && h <= 6 ? h + 12 : h;
    return { time: to24h(adj, +m24!), ambiguous: h <= 12 };
  }
  return { ambiguous: false };
}

export function parseTime(text: string): string | undefined {
  const m = TIME_RE.exec(text);
  return m ? timeFromGroups(Array.from(m), 1).time : undefined;
}

function parseAmount(text: string): number | undefined {
  const m = AMOUNT_RE.exec(text);
  if (!m) return undefined;
  if (m[1]) return Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  if (m[3]) return Number(m[3]);
  return undefined;
}

function addMinutes(t: string, mins: number): string | undefined {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  if (total >= 24 * 60) return undefined;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const isNameish = (s: string) => {
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  return words.every((w) => /^[A-Z][\w'’.-]*$/.test(w) || /^[A-Z]\.?$/.test(w) || /^&$/.test(w));
};

interface Header {
  clientName: string;
  startTime?: string;
  endTime?: string;
  amount?: number;
  hours?: number;
  ambiguousTime: boolean;
}

/** Detects a job header line such as "Andrew Dana - 10am ($30)" or "10:00am Sonia $25". */
export function parseHeader(line: string): Header | null {
  if (isStreetLine(line)) return null;
  let rest = line
    // "12 noon", "noon", "midday" → 12pm
    .replace(/\b(?:12\s*)?(?:noon|midday)\b/i, '12pm')
    // "9-11am", "11 to 1pm": the first time borrows am/pm from the second (flipped when it would otherwise run backwards)
    .replace(/\b(\d{1,2})((?:[:.]\d{2})?)(\s*(?:[-–—]|to|until|till)\s*)(\d{1,2})((?:[:.]?\d{2})?)\s*(am|pm)\b/i, (_m, h1, m1, sep, h2, m2, mer) => {
      const a = Number(h1) % 12, b = Number(h2) % 12, pm = /p/i.test(mer);
      const first = a > b || (a === b && m1 > m2) ? (pm ? 'am' : 'pm') : mer;
      return `${h1}${m1}${first}${sep}${h2}${m2}${mer}`;
    });
  let startTime: string | undefined, endTime: string | undefined, ambiguous = false;

  const range = RANGE_RE.exec(rest);
  if (range) {
    const g = Array.from(range);
    const a = timeFromGroups(g, 1), b = timeFromGroups(g, 6);
    startTime = a.time;
    endTime = b.time;
    // "9-11am": first part inherits meridiem handled by regex only if present; fall back sensibly
    ambiguous = a.ambiguous || b.ambiguous;
    rest = rest.replace(range[0], ' ');
  } else {
    const t = TIME_RE.exec(rest);
    if (t) {
      const r = timeFromGroups(Array.from(t), 1);
      startTime = r.time;
      ambiguous = r.ambiguous;
      rest = rest.replace(t[0], ' ');
    } else {
      // No am/pm and no colon — "Name - 9 ($40)", "Name - 930 ($40)", "Name - 0900 $40". Only trusted when the line
      // also carries a price, and flagged so the time gets checked.
      const bare = BARE_TIME_RE.exec(rest);
      if (!bare || parseAmount(rest) === undefined) return null;
      const h = Number(bare[1]), min = Number(bare[2] ?? 0);
      startTime = to24h(h >= 1 && h <= 6 ? h + 12 : h, min);
      ambiguous = true;
      rest = rest.slice(0, bare.index) + ' ' + rest.slice(bare.index + bare[0].length - bare[3].length);
    }
  }
  if (!startTime) return null;

  const amount = parseAmount(rest);
  if (amount !== undefined) rest = rest.replace(AMOUNT_RE, ' ');
  let hours: number | undefined;
  const hm = HOURS_RE.exec(rest);
  if (hm) {
    hours = Number(hm[1]);
    rest = rest.replace(hm[0], ' ');
  }

  const name = rest
    .replace(/^\s*(?:\d{1,2}\s*[.)]|#\s*\d{1,2}\b)\s*/, '') // "1) Name", "2. Name", "#3 Name"
    .replace(/[()[\]|•*]/g, ' ')
    .replace(/\s[-–—:@,]\s/g, ' ')
    .replace(/^[\s\-–—:@,.]+|[\s\-–—:@,.]+$/g, '')
    .replace(/^(?:at|with|for)\s+|\s+(?:at|with|for)$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Without an amount, only accept clean "Name time" lines, to avoid e.g. "Arrive by 9am please"
  if (amount === undefined && !isNameish(name)) return null;
  if (name && !/[a-z]/i.test(name)) return null;
  if (name.split(' ').length > 8) return null;

  if (startTime && !endTime && hours) endTime = addMinutes(startTime, Math.round(hours * 60));
  return { clientName: name, startTime, endTime, amount, hours, ambiguousTime: ambiguous };
}

function normaliseTask(part: string): string {
  const p = part.trim().replace(/[.!]+$/, '');
  const l = p.toLowerCase();
  const bed = /\bchang(?:e|ing)\s+(?:the\s+)?(?:bed|sheets|linen)s?(?:\s+(?:in|of)\s+(?:the\s+)?(.+))?/i.exec(p);
  if (bed) return bed[1] ? `Change ${bed[1].trim().replace(/\s*bedroom$/i, ' bedroom').toLowerCase()} bed` : 'Change bed';
  if (/^dust/.test(l)) return 'Dusting';
  if (/^wip(e|ing)/.test(l)) return /surface|bench|counter|top/.test(l) ? 'Wiping surfaces' : 'Wiping down';
  if (/^(vacuum|hoover)/.test(l)) return 'Vacuuming';
  if (/^mop/.test(l)) return 'Mopping';
  if (/^sweep/.test(l)) return 'Sweeping';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

const startsWithAction = (s: string) => {
  const w = s.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
  return ACTION_WORDS.some((a) => w === a || w.startsWith(a));
};

function extractTasks(sentence: string): string[] | null {
  const commaParts = sentence.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const cp of commaParts) {
    // split on "and" only when the following phrase is itself an action: "vacuum and mop floor"
    const sub = cp.split(/\s+(?:and|&|then)\s+/i);
    let acc = sub[0];
    for (let i = 1; i < sub.length; i++) {
      if (startsWithAction(sub[i])) {
        parts.push(acc);
        acc = sub[i];
      } else acc += ' and ' + sub[i];
    }
    parts.push(acc);
  }
  if (!parts.some(startsWithAction)) return null;
  return parts.map(normaliseTask);
}

function countFrom(text: string, re: RegExp): number | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const v = m[1].toLowerCase();
  return NUM_WORDS[v] ?? Number(v);
}

function analyseBlock(job: ParsedJob, lines: string[]) {
  const addressLines: string[] = [];
  const textLines: string[] = [];
  let addressDone = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || SEPARATOR_RE.test(line)) continue;
    if (!addressDone && isStreetLine(line)) {
      addressLines.push(line);
      continue;
    }
    if (!addressDone && addressLines.length === 1 && isLocalityLine(line)) {
      addressLines.push(line);
      addressDone = true;
      continue;
    }
    if (addressLines.length) addressDone = true;
    textLines.push(line);
  }
  if (addressLines.length) job.address = parseAddress(addressLines);

  const descriptionParts: string[] = [];
  const tasks: string[] = [];
  const special: string[] = [];
  // Ticked / bulleted lines are a checklist: each one is a task exactly as written
  const prose: string[] = [];
  for (const l of textLines) {
    const c = CHECK_RE.exec(l);
    if (c && !ACCESS_EMOJI_RE.test(l)) tasks.push(c[1].replace(/[.\s]+$/, '').replace(/^./, (ch) => ch.toUpperCase()));
    else if (ACCESS_EMOJI_RE.test(l)) special.push(l); // 🔑 / 🔐 lines say how to get in, whatever words they use
    else prose.push(l);
  }
  const sentences = prose.flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const phone = PHONE_RE.exec(s);
    if (phone && s.replace(phone[0], '').replace(/[^a-z]/gi, '').length < 8) {
      special.push(`Phone: ${phone[0]}`);
      continue;
    }
    const t = extractTasks(s);
    if (t && !SPECIAL_RE.test(s)) tasks.push(...t);
    else if (SPECIAL_RE.test(s)) special.push(s);
    else descriptionParts.push(s);
  }
  const allText = textLines.join(' ');
  const N = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  job.bathrooms = countFrom(allText, new RegExp(`\\b${N}\\s*(?:bath(?:room)?s?|toilets?)\\b`, 'i'));
  const withoutBaths = allText.replace(new RegExp(`\\b${N}\\s*(?:bath(?:room)?s?|toilets?)\\b`, 'gi'), ' ');
  job.rooms = countFrom(withoutBaths, new RegExp(`\\b${N}\\s*(?:bed)?rooms?\\b`, 'i'));
  job.tasks = Array.from(new Set(tasks));
  if (descriptionParts.length) job.description = descriptionParts.join(' ');
  if (special.length) job.specialInstructions = special.join(' ');
}

function parsePaymentLine(line: string, today: string): ParsedPayment | null {
  if (!PAYMENT_HINT_RE.test(line)) return null;
  const amount = parseAmount(line);
  if (amount === undefined) return null;
  const payer = /\bfrom\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})/.exec(line)?.[1];
  const reference = /\b(INV[-\s]?[\w-]+)/i.exec(line)?.[1] ?? /\bref(?:erence)?[:\s#]+([\w-]+)/i.exec(line)?.[1];
  const d = findDate(line, today);
  const warnings: string[] = [];
  if (!d) warnings.push('No date found — defaulted to today');
  if (!payer) warnings.push('Payer not detected');
  return {
    tempId: tempId('pay'),
    amount,
    date: d?.date ?? today,
    payer,
    reference,
    description: line.length > 140 ? line.slice(0, 140) + '…' : line,
    sourceText: line,
    warnings,
  };
}

export interface ParseOptions {
  today: string; // YYYY-MM-DD in user's timezone
}

export function parseMessage(input: string, opts: ParseOptions): ParseResult {
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/[‒-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, ' ');
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());

  const result: ParseResult = {
    kind: 'unknown',
    jobs: [],
    payments: [],
    summary: { jobCount: 0, paymentCount: 0, totalAmount: 0, addressCount: 0, dateCount: 0, dates: [] },
    warnings: [],
    unparsedLines: [],
  };

  let currentDate: string | undefined;
  let current: { job: ParsedJob; lines: string[] } | null = null;
  const blocks: { job: ParsedJob; lines: string[] }[] = [];

  for (const line of lines) {
    if (!line) continue;

    if (!blocks.length && !current) {
      const g = GREETING_RE.exec(line);
      if (g && line.split(' ').length <= 5) {
        if (g[1]) result.recipientName = g[1].replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        continue;
      }
    }

    const meet = MEETING_RE.exec(line);
    if (meet && /\b(meet|start|pick)/i.test(line.split(' ')[0] + ' ' + (line.split(' ')[1] ?? ''))) {
      result.meetingPoint = meet[1].replace(/[.,]+$/, '').trim();
      if (meet[2]) result.meetingTime = parseTime(meet[2]);
      continue;
    }

    const header = parseHeader(line);
    if (header) {
      if (current) blocks.push(current);
      const job: ParsedJob = {
        tempId: tempId('job'),
        clientName: header.clientName,
        date: currentDate,
        startTime: header.startTime,
        endTime: header.endTime,
        hours: header.hours,
        amount: header.amount,
        address: {},
        tasks: [],
        sourceText: line,
        confidence: 1,
        warnings: header.ambiguousTime ? ['Time had no am/pm — please check'] : [],
      };
      // A date written on the header line itself overrides the schedule date
      const inline = findDate(line, opts.today);
      if (inline) job.date = inline.date;
      current = { job, lines: [] };
      continue;
    }

    const payment = parsePaymentLine(line, opts.today);
    if (payment && !current) {
      result.payments.push(payment);
      continue;
    }

    // Date lines: before any job, or a short stand-alone date line between jobs (multi-day schedules)
    const d = findDate(line, opts.today);
    if (d && !isStreetLine(line) && (!current || line.length - d.length <= 22)) {
      currentDate = d.date;
      if (!result.scheduleDate) result.scheduleDate = d.date;
      if (current) {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    if (current) {
      current.lines.push(line);
      current.job.sourceText += '\n' + line;
    } else {
      result.unparsedLines.push(line);
    }
  }
  if (current) blocks.push(current);

  for (const b of blocks) {
    analyseBlock(b.job, b.lines);
    const j = b.job;
    if (result.meetingPoint && blocks.indexOf(b) === 0) j.meetingPoint = result.meetingPoint;
    if (!j.clientName) {
      j.clientName = 'Unknown client';
      j.warnings.push('Client name not found');
      j.confidence -= 0.2;
    }
    if (!j.date) {
      j.warnings.push('No date found — please set the date');
      j.confidence -= 0.25;
    }
    if (j.amount === undefined) {
      j.warnings.push('No payment amount found');
      j.confidence -= 0.2;
    }
    if (!j.address.line1) {
      j.warnings.push('No street address found');
      j.confidence -= 0.15;
    } else if (!j.address.suburb) {
      j.warnings.push('Suburb not detected');
      j.confidence -= 0.05;
    }
    j.confidence = Math.max(0, Math.round(j.confidence * 100) / 100);
    result.jobs.push(j);
  }

  const dates = Array.from(new Set(result.jobs.map((j) => j.date).filter(Boolean) as string[])).sort();
  result.summary = {
    jobCount: result.jobs.length,
    paymentCount: result.payments.length,
    totalAmount: Math.round(result.jobs.reduce((a, j) => a + (j.amount ?? 0), 0) * 100) / 100,
    addressCount: result.jobs.filter((j) => j.address.line1).length,
    dateCount: dates.length,
    dates,
  };
  result.kind = result.jobs.length && result.payments.length ? 'mixed' : result.jobs.length ? 'schedule' : result.payments.length ? 'payment' : 'unknown';
  if (result.kind === 'unknown') result.warnings.push('No jobs or payments could be detected. Check the format or add records manually.');
  return result;
}

/** Stable hash input for duplicate-import detection. */
export function normaliseForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
