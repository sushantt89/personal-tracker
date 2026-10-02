import { GoogleAccount } from '../../models/index.js';
import { googleConfigured, GOOGLE_SCOPES } from '../google/client.js';
import type { OcrService, TravelService, IntegrationStatus } from './types.js';
import { scanReceipt } from '../ocr/index.js';

export interface GoogleStatus extends IntegrationStatus {
  email?: string;
  needsReconnect?: boolean;
  lastError?: string | null;
  lastCalendarSyncAt?: Date | null;
  missingScopes?: string[];
}

/** Real connection status for Google (Calendar + Drive share one connection). */
export async function googleStatus(userId: string): Promise<{ googleCalendar: GoogleStatus; googleDrive: GoogleStatus }> {
  const configured = googleConfigured();
  const acc = configured ? await GoogleAccount.findOne({ userId }).lean() : null;
  const scopes = acc?.scopes ?? [];
  const has = (s: string) => scopes.includes(s);
  const common = { configured, email: acc?.googleEmail ?? undefined, needsReconnect: acc?.needsReconnect ?? false, lastError: acc?.lastError ?? null, lastCalendarSyncAt: acc?.lastCalendarSyncAt ?? null };
  const make = (provider: string, scope: string, label: string): GoogleStatus => {
    const connected = Boolean(acc && !acc.needsReconnect && has(scope));
    let message: string;
    if (!configured) message = 'Not set up on the server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to .env (see docs/GOOGLE_SETUP.md).';
    else if (!acc) message = `Connect your Google account to use ${label}.`;
    else if (acc.needsReconnect) message = 'Google access expired or was revoked. Please reconnect.';
    else if (!has(scope)) message = `Connected as ${acc.googleEmail}, but ${label} permission wasn't granted. Reconnect and tick the ${label} box.`;
    else message = `Connected as ${acc.googleEmail}.`;
    return { provider, connected, message, missingScopes: GOOGLE_SCOPES.filter((s) => s.startsWith('https') && !has(s)), ...common };
  };
  return {
    googleCalendar: make('google_calendar', 'https://www.googleapis.com/auth/calendar.events', 'Google Calendar'),
    googleDrive: make('google_drive', 'https://www.googleapis.com/auth/drive.file', 'Google Drive'),
  };
}

/** Local receipt OCR (tesseract.js running inside this server; no external service). */
export const ocrService: OcrService = {
  available: () => true,
  extract: async (data, mimeType) => {
    const r = await scanReceipt(data, mimeType, new Date().toISOString().slice(0, 10));
    return { merchant: r.merchant, date: r.date, total: r.total, gst: r.gst, items: r.items, rawText: r.rawText };
  },
};

/** Distance & travel lives in services/travel (OpenStreetMap by default, OpenRouteService with a key). */
export const travelService: TravelService = {
  available: () => true,
  route: async (from, to) => {
    const { travelProvider } = await import('../travel/index.js');
    const p = travelProvider();
    const [a, b] = (await Promise.all([p.geocode(from), p.geocode(to)])).map((r) => r[0]);
    if (!a || !b) return null;
    const r = await p.route([a, b]);
    return r?.legs[0] ? { distanceKm: r.legs[0].km, minutes: r.legs[0].minutes } : null;
  },
};

export * from './types.js';
