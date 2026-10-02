export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Local calendar date YYYY-MM-DD, sent to the API so "today" follows the device. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const query = { today: localToday(), ...(opts.query ?? {}) };
  const res = await fetch(`/api${path}${qs(query)}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    credentials: 'include',
    headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : undefined;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const details = (data as { details?: { path: string; message: string }[] })?.details;
    let msg = (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    if (Array.isArray(details) && details.length && details[0]?.message) msg = `${msg}: ${details.map((d) => (d.path ? `${d.path} – ${d.message}` : d.message)).join('; ')}`;
    throw new ApiError(res.status, msg, details);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown, query?: Query) => api<T>(path, { method: 'POST', body: body ?? {}, query });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Build a URL for file downloads (PDF/CSV) — same-origin cookie auth applies. */
export const fileUrl = (path: string, query?: Query) => `/api${path}${qs({ today: localToday(), ...(query ?? {}) })}`;
