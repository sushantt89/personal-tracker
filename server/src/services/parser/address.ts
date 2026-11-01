import type { ParsedAddress } from './types.js';

const STATES: Record<string, string> = {
  sa: 'SA', 'south australia': 'SA', nsw: 'NSW', 'new south wales': 'NSW', vic: 'VIC', victoria: 'VIC',
  qld: 'QLD', queensland: 'QLD', wa: 'WA', 'western australia': 'WA', tas: 'TAS', tasmania: 'TAS',
  nt: 'NT', 'northern territory': 'NT', act: 'ACT', 'australian capital territory': 'ACT',
};

export const STREET_SUFFIXES = [
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'av', 'terrace', 'tce', 'drive', 'dr', 'court', 'ct', 'place', 'pl',
  'crescent', 'cres', 'cr', 'highway', 'hwy', 'parade', 'pde', 'way', 'lane', 'ln', 'boulevard', 'blvd', 'close', 'cl',
  'grove', 'gr', 'circuit', 'cct', 'square', 'sq', 'esplanade', 'esp', 'walk', 'rise', 'mews', 'row', 'track', 'parkway', 'pkwy',
  'promenade', 'gardens', 'gdns', 'link', 'loop', 'view', 'vista', 'ridge', 'retreat', 'glen', 'green', 'brace', 'mall', 'alley',
];
const SUFFIX_RE = STREET_SUFFIXES.join('|');

const streetRe = (minWords: number) => new RegExp(
  `^\\s*((?:(?:unit|u|apt|apartment|flat|shop)\\s*\\d+[a-z]?\\s*[/,]?\\s*|\\d+[a-z]?\\s*/\\s*)?\\d+[a-z]?(?:\\s*-\\s*\\d+[a-z]?)?(?:\\s*,\\s*|\\s+)(?:[a-z'.-]+\\s+){${minWords},4}?(?:${SUFFIX_RE})\\b\\.?)(.*)$`,
  'i',
);
/** A street line: optional unit, number (a comma after it is tolerated: "29, Example Street"), 0-4 words, a street suffix. */
const STREET_RE = streetRe(0);
/** The same, but with a street name before the suffix. Tried first, so "11 Vista Terrace" isn't cut short at "Vista" (itself a suffix). */
const NAMED_STREET_RE = streetRe(1);
const matchStreet = (text: string) => NAMED_STREET_RE.exec(text) ?? STREET_RE.exec(text);

export function isStreetLine(line: string): boolean {
  return STREET_RE.test(line);
}

/**
 * The street part of a line that may have something in front of it: a map-pin icon read as "Q", "9" or "@"
 * ("Q 29 Example St"), or a place name followed by a comma ("Example Library, 29 Example St, Sampleton SA").
 * Text before the number is only skipped when it is 1-2 characters of junk, ends in a comma, or the rest of the line
 * has a suburb/state/postcode — so a task such as "Mop 3 rooms then walk" isn't taken for an address.
 */
export function findStreet(line: string): string | undefined {
  const t = line.trim();
  if (isStreetLine(t)) return t;
  const re = /(?:^|[\s,(])((?:unit|u|apt|flat|shop)\s*\d|\d)/gi;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const at = m.index + m[0].length - m[1].length;
    if (at === 0) continue;
    const rest = t.slice(at), before = t.slice(0, at).trim();
    if (!isStreetLine(rest)) continue;
    if (before.replace(/[^A-Za-z0-9]/g, '').length <= 2 || /,$/.test(before) || hasLocality(rest)) return rest;
  }
  return undefined;
}

const POSTCODE_RE = /\b(\d{4})\b/;
const STATE_RE = new RegExp(`\\b(${Object.keys(STATES).sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');

/** A locality line such as "Goodwood, SA, Australia", "Frewville SA 5063", "Hawthorn 5062". */
export function isLocalityLine(line: string): boolean {
  const t = line.trim();
  if (t.split(/\s+/).length > 7 || /\$/.test(t)) return false;
  if (/\d{1,2}(:\d{2})?\s*(am|pm)/i.test(t)) return false;
  return STATE_RE.test(t) || /\baustralia\b/i.test(t) || /^[a-z' .-]+,?\s+\d{4}$/i.test(t);
}

/** Whether text carries a state or a 4-digit postcode after a street ("29 Example St, Sampleton SA 5000"). */
const hasLocality = (text: string) => STATE_RE.test(text) || /\b\d{4}\b/.test(text.replace(/^\s*\S+/, ''));

export function stateFromPostcode(pc: string): string | undefined {
  const n = Number(pc);
  if (n >= 800 && n <= 999) return 'NT';
  if ((n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if (n >= 1000 && n <= 2999) return 'NSW';
  if (n >= 3000 && n <= 3999) return 'VIC';
  if (n >= 4000 && n <= 4999) return 'QLD';
  if (n >= 5000 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7999) return 'TAS';
  return undefined;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());

function parseLocality(rest: string, out: ParsedAddress) {
  let s = ` ${rest} `;
  if (/\baustralia\b/i.test(s)) {
    out.country = 'Australia';
    s = s.replace(/\baustralia\b/gi, ' ');
  }
  const pc = POSTCODE_RE.exec(s);
  if (pc) {
    out.postcode = pc[1];
    s = s.replace(pc[0], ' ');
  }
  const st = STATE_RE.exec(s);
  if (st) {
    out.state = STATES[st[1].toLowerCase()];
    s = s.slice(0, st.index) + ' ' + s.slice(st.index + st[0].length);
  }
  const suburb = s.replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (suburb) out.suburb = titleCase(suburb);
  if (!out.state && out.postcode) out.state = stateFromPostcode(out.postcode);
  if (out.state && !out.country) out.country = 'Australia';
}

export function formatAddress(a: ParsedAddress): string {
  const locality = [a.suburb, a.state, a.postcode].filter(Boolean).join(' ');
  return [a.line1, locality].filter(Boolean).join(', ');
}

/** Parse one or two address lines into components. */
export function parseAddress(lines: string[]): ParsedAddress {
  const out: ParsedAddress = {};
  const joined = lines.map((l) => l.trim()).filter(Boolean).join(', ');
  if (!joined) return out;
  const m = matchStreet(joined);
  if (m) {
    // "29, Example Street" → "29 Example Street" (maps and routing don't find it with the comma)
    out.line1 = m[1].replace(/(\d[a-z]?)\s*,\s*(?=[a-z])/i, '$1 ').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    parseLocality(m[2].replace(/^[\s,]+/, ''), out);
  } else {
    parseLocality(joined, out);
  }
  out.formatted = formatAddress(out);
  return out;
}

export function googleMapsUrl(a: ParsedAddress | string): string {
  const q = typeof a === 'string' ? a : [a.line1, a.suburb, a.state, a.postcode, a.country].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
