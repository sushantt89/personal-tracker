import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { GoogleAccount } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, HttpError } from '../utils/httpError.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { GOOGLE_SCOPES, googleConfigured, oauthClient } from '../services/google/client.js';
import { syncAll } from '../services/google/calendar.js';
import { setupDriveFolders } from '../services/google/drive.js';

const r = Router();
const back = (query: string) => `${env.CLIENT_URL.split(',')[0].replace(/\/$/, '')}/settings?tab=integrations&${query}`;

/** Step 1: get Google's consent URL. `state` is a short-lived signed token tying the callback to this user. */
r.get('/auth-url', requireAuth, (req, res) => {
  if (!googleConfigured()) throw new HttpError(409, 'Google is not set up on the server. See docs/GOOGLE_SETUP.md.');
  const state = jwt.sign({ sub: req.userId, purpose: 'google-oauth', n: crypto.randomBytes(8).toString('hex') }, env.JWT_SECRET, { expiresIn: '10m' });
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES, state, include_granted_scopes: true });
  res.json({ url });
});

/** Step 2: Google redirects here. Public route — authenticated by the signed state. */
r.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return res.redirect(back(`google=error&reason=${encodeURIComponent(error)}`));
  let userId: string;
  try {
    const p = jwt.verify(state ?? '', env.JWT_SECRET) as { sub: string; purpose: string };
    if (p.purpose !== 'google-oauth') throw new Error('bad purpose');
    userId = p.sub;
  } catch {
    return res.redirect(back('google=error&reason=expired_or_invalid_state'));
  }
  if (!code) return res.redirect(back('google=error&reason=missing_code'));
  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    let email: string | undefined;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
      email = ticket.getPayload()?.email;
    }
    const existing = await GoogleAccount.findOne({ userId }).select('+refreshTokenEnc');
    const refresh = tokens.refresh_token ?? (existing ? decrypt(existing.refreshTokenEnc) : undefined);
    if (!refresh) return res.redirect(back('google=error&reason=no_refresh_token'));
    await GoogleAccount.findOneAndUpdate(
      { userId },
      { userId, googleEmail: email, refreshTokenEnc: encrypt(refresh), scopes: (tokens.scope ?? '').split(' ').filter(Boolean), connectedAt: new Date(), needsReconnect: false, lastError: null },
      { upsert: true },
    );
    res.redirect(back('google=connected'));
  } catch (e) {
    console.error('[google] OAuth callback failed', e);
    res.redirect(back('google=error&reason=token_exchange_failed'));
  }
});

r.post('/disconnect', requireAuth, async (req, res) => {
  const acc = await GoogleAccount.findOne({ userId: req.userId }).select('+refreshTokenEnc');
  if (acc) {
    try {
      await oauthClient().revokeToken(decrypt(acc.refreshTokenEnc));
    } catch {
      /* already revoked or expired — removing locally is enough */
    }
    await acc.deleteOne();
  }
  res.json({ ok: true });
});

/** Sync everything to Google Calendar now (also removes events for types you turned off). */
r.post('/calendar/sync', requireAuth, async (req, res) => {
  const body = parseBody(z.object({ removeAll: z.boolean().optional() }), req.body ?? {});
  try {
    res.json({ counts: await syncAll(req.userId!, body) });
  } catch (e) {
    throw badRequest((e as Error).message);
  }
});

r.post('/drive/setup', requireAuth, async (req, res) => {
  try {
    res.json(await setupDriveFolders(req.userId!));
  } catch (e) {
    throw badRequest((e as Error).message);
  }
});

export default r;
