import { env } from '../../config/env.js';

export interface LatLng { lat: number; lng: number }
export interface GeocodeResult extends LatLng { displayName?: string; postcode?: string }
export interface RouteResult { legs: { km: number; minutes: number }[] }

/** Swappable map provider (tests use a fake). */
export interface TravelProvider {
  name: string;
  /** Candidate matches, best first (empty when nothing is found). */
  geocode(query: string, countryCode?: string): Promise<GeocodeResult[]>;
  route(points: LatLng[]): Promise<RouteResult | null>;
}

const UA = 'PersonalTracker/0.1 (self-hosted personal finance app)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
    return (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally {
    clearTimeout(t);
  }
}

// Nominatim's usage policy allows at most 1 request per second — serialise lookups.
let nominatimChain: Promise<unknown> = Promise.resolve();
function nominatimThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    try { return await fn(); } finally { await sleep(1100); }
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

/** Photon (photon.komoot.io): OpenStreetMap address search, used when Nominatim has nothing or refuses. */
export async function photonGeocode(query: string, countryCode = 'au'): Promise<GeocodeResult[]> {
  const data = await getJson(`https://photon.komoot.io/api/?limit=8&lang=en&q=${encodeURIComponent(query)}`);
  const cc = countryCode.toUpperCase();
  return (data.features ?? [])
    .filter((f: any) => !cc || f.properties?.countrycode === cc) // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((f: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const p = f.properties ?? {};
      const street = [p.housenumber, p.street ?? (p.type === 'street' ? p.name : undefined)].filter(Boolean).join(' ');
      const place = p.city ?? p.district ?? p.locality ?? p.county;
      return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], displayName: [p.type === 'street' ? '' : p.name, street, place, p.state, p.postcode, p.country].filter(Boolean).join(', '), postcode: p.postcode };
    });
}

/** Free OpenStreetMap services: Nominatim (addresses) + OSRM (driving routes). No API key. */
export const osmProvider: TravelProvider = {
  name: 'OpenStreetMap (Nominatim + OSRM)',
  async geocode(query, countryCode = 'au') {
    const base = env.NOMINATIM_URL.replace(/\/$/, '');
    const url = `${base}/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=${encodeURIComponent(countryCode)}&q=${encodeURIComponent(query)}`;
    // Nominatim often refuses shared cloud servers (403/429) — fall back to Photon (also OpenStreetMap data, no key)
    let first: Error | undefined;
    let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { data = await nominatimThrottle(() => getJson(url)); } catch (e) { first = e as Error; }
    if (!Array.isArray(data) || !data.length) {
      try {
        const hits = await photonGeocode(query, countryCode);
        if (hits.length || !first) return hits;
      } catch (e) { if (!first) throw e; }
      if (first) throw first;
      return [];
    }
    return (Array.isArray(data) ? data : []).map((h: any) => ({ lat: Number(h.lat), lng: Number(h.lon), displayName: h.display_name, postcode: h.address?.postcode })); // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  async route(points) {
    if (points.length < 2) return { legs: [] };
    const base = env.OSRM_URL.replace(/\/$/, '');
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const data = await getJson(`${base}/route/v1/driving/${coords}?overview=false&steps=false`);
    if (data.code !== 'Ok' || !data.routes?.[0]) return null;
    return { legs: data.routes[0].legs.map((l: { distance: number; duration: number }) => ({ km: round1(l.distance / 1000), minutes: Math.round(l.duration / 60) })) };
  },
};

/** OpenRouteService (free key, 2,000 requests/day) — used when ORS_API_KEY is set. */
export const orsProvider: TravelProvider = {
  name: 'OpenRouteService',
  async geocode(query, countryCode = 'au') {
    const data = await getJson(`https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(env.ORS_API_KEY)}&size=5&boundary.country=${countryCode.toUpperCase()}&text=${encodeURIComponent(query)}`);
    return (data.features ?? []).map((f: any) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], displayName: f.properties?.label, postcode: f.properties?.postalcode })); // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  async route(points) {
    if (points.length < 2) return { legs: [] };
    const data = await getJson('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) }),
    });
    const segs = data.routes?.[0]?.segments;
    if (!segs) return null;
    return { legs: segs.map((s: { distance: number; duration: number }) => ({ km: round1(s.distance / 1000), minutes: Math.round(s.duration / 60) })) };
  },
};

let override: TravelProvider | null = null;
export const setTravelProvider = (p: TravelProvider | null) => { override = p; };
export const travelProvider = (): TravelProvider => override ?? (env.ORS_API_KEY ? orsProvider : osmProvider);
