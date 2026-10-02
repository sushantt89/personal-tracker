/**
 * Integration interfaces. Phase 1 ships "not connected" implementations so the rest of the
 * app can call these safely; phase 2 adds Google OAuth + real providers behind the same API.
 */

export interface IntegrationStatus {
  provider: string;
  configured: boolean; // server has credentials (env)
  connected: boolean; // user has authorised
  message: string;
}

/** Google Calendar and Drive are implemented in services/google (calendar.ts, drive.ts). */

export interface OcrResult {
  merchant?: string;
  date?: string;
  total?: number;
  gst?: number;
  items?: { description: string; amount?: number }[];
  rawText: string;
}

export interface OcrService {
  available(): boolean;
  extract(data: Buffer, mimeType: string): Promise<OcrResult | null>;
}

export interface TravelService {
  available(): boolean;
  /** Distance/time between two addresses. */
  route(from: string, to: string): Promise<{ distanceKm: number; minutes: number } | null>;
}
