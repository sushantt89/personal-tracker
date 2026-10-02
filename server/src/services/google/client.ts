import { OAuth2Client } from 'google-auth-library';
import { calendar, type calendar_v3 } from '@googleapis/calendar';
import { drive, type drive_v3 } from '@googleapis/drive';
import { env } from '../../config/env.js';
import { GoogleAccount } from '../../models/index.js';
import { decrypt, encrypt } from '../../utils/crypto.js';

/**
 * Least-privilege scopes:
 *  - calendar.events: create/update/delete the events this app manages
 *  - drive.file: only files and folders this app creates (cannot see the rest of your Drive)
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
];

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);

export const oauthClient = () =>
  new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI });

export interface GoogleApis {
  calendar: calendar_v3.Calendar;
  drive: drive_v3.Drive;
}

type Factory = (userId: string) => Promise<GoogleApis | null>;

async function defaultFactory(userId: string): Promise<GoogleApis | null> {
  if (!googleConfigured()) return null;
  const acc = await GoogleAccount.findOne({ userId }).select('+refreshTokenEnc');
  if (!acc || acc.needsReconnect) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decrypt(acc.refreshTokenEnc) });
  auth.on('tokens', (t) => {
    if (t.refresh_token) GoogleAccount.updateOne({ _id: acc._id }, { refreshTokenEnc: encrypt(t.refresh_token) }).catch(() => undefined);
  });
  return { calendar: calendar({ version: 'v3', auth }), drive: drive({ version: 'v3', auth }) };
}

let factory: Factory = defaultFactory;
/** Tests replace the Google client with a fake. */
export const setGoogleApiFactory = (f: Factory | null) => {
  factory = f ?? defaultFactory;
};
export const googleApis = (userId: string) => factory(userId);

/* eslint-disable @typescript-eslint/no-explicit-any */
export const errorStatus = (e: any): number | undefined => e?.code ?? e?.status ?? e?.response?.status;
export const isNotFound = (e: any) => [404, 410].includes(Number(errorStatus(e)));
export const isAuthError = (e: any) =>
  Number(errorStatus(e)) === 401 || /invalid_grant|invalid_token|unauthorized_client/i.test(String(e?.message ?? e?.response?.data?.error ?? ''));

/** Records the error on the account; revoked/expired access flags the account for reconnection. */
export async function recordGoogleError(userId: string, e: any, context: string) {
  const message = `${context}: ${e?.response?.data?.error?.message ?? e?.message ?? String(e)}`.slice(0, 500);
  console.error('[google]', message);
  await GoogleAccount.updateOne({ userId }, { lastError: message, ...(isAuthError(e) ? { needsReconnect: true } : {}) }).catch(() => undefined);
  return message;
}
