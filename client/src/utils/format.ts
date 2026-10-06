import dayjs from 'dayjs';
export { localToday } from '../api/client';

let currency = 'AUD';
export const setCurrency = (c: string) => (currency = c || 'AUD');

export const money = (n?: number | null, opts: { compact?: boolean; cents?: boolean } = {}) => {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency,
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.compact ? 0 : opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.compact ? 1 : opts.cents === false ? 0 : 2,
  }).format(n);
};

export const fmtDate = (s?: string | null, f = 'D MMM YYYY') => (s ? dayjs(s).format(f) : '—');
export const fmtShort = (s?: string | null) => (s ? dayjs(s).format('D MMM') : '—');
export const fmtMonth = (key: string) => dayjs(key + '-01').format('MMM YY');
export const fmtTime = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export const fmtDay = (s: string) => dayjs(s).format('dddd D MMMM');
export const addDays = (s: string, n: number) => dayjs(s).add(n, 'day').format('YYYY-MM-DD');
export const startOfMonth = (s: string) => dayjs(s).startOf('month').format('YYYY-MM-DD');
export const endOfMonth = (s: string) => dayjs(s).endOf('month').format('YYYY-MM-DD');
export const startOfWeek = (s: string) => {
  const d = dayjs(s);
  return d.subtract((d.day() + 6) % 7, 'day').format('YYYY-MM-DD');
};
export const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const mapsUrl = (q?: string) => (q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : undefined);
/**
 * Google Maps directions that START FROM WHERE YOU ARE and visit every stop in order.
 * (Listing the stops as /dir/a/b/c makes Maps treat the first one as the starting point, so navigation skips it.)
 * The last stop is the destination and the ones before it are waypoints; leaving the origin out means "my location".
 */
export const directionsUrl = (stops: string[]) => {
  const list = stops.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return undefined;
  const params = new URLSearchParams({ api: '1', destination: list[list.length - 1], travelmode: 'driving' });
  if (list.length > 1) params.set('waypoints', list.slice(0, -1).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};
