import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import bcrypt from 'bcryptjs';
import { GoogleAccount, User } from '../models/index.js';
import { requireAuth, signToken, cookieOptions, COOKIE_NAME } from '../middleware/auth.js';
import { ensureUserDefaults } from '../services/defaults.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, HttpError } from '../utils/httpError.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { GOOGLE_SCOPES, GOOGLE_LOGIN_SCOPES, googleConfigured, oauthClient, exchangeLoginCode } from '../services/google/client.js';
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

// ---------- Sign in with Google ----------
const LOGIN_NONCE_COOKIE = 'pt_oauth';
const toLogin = (reason: string) => `${env.CLIENT_URL.split(',')[0].replace(/\/$/, '')}/login?google=error&reason=${encodeURIComponent(reason)}`;

/** Public: where to send the browser to sign in with Google. A one-time code in a cookie ties the answer to this browser. */
r.get('/login-url', (_req, res) => {
  if (!googleConfigured()) throw new HttpError(409, 'Sign in with Google is not set up on the server.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign({ purpose: 'google-login', n: nonce }, env.JWT_SECRET, { expiresIn: '10m' });
  res.cookie(LOGIN_NONCE_COOKIE, nonce, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
  res.json({ url: oauthClient().generateAuthUrl({ access_type: 'online', prompt: 'select_account', scope: GOOGLE_LOGIN_SCOPES, state }) });
});

async function finishGoogleLogin(req: Request, res: Response, code: string | undefined, nonce: string) {
  const cookieNonce = req.cookies?.[LOGIN_NONCE_COOKIE];
  res.clearCookie(LOGIN_NONCE_COOKIE, { ...cookieOptions(), maxAge: undefined });
  // The sign-in must finish in the same browser that started it
  if (!cookieNonce || cookieNonce !== nonce) return res.redirect(toLogin('expired_or_invalid_state'));
  if (!code) return res.redirect(toLogin('missing_code'));
  try {
    const id = await exchangeLoginCode(code);
    if (!id.emailVerified) return res.redirect(toLogin('email_not_verified'));
    // Known Google identity → that account. Otherwise an existing account with the same (Google-verified) email is linked. Otherwise a new account.
    let user = await User.findOne({ googleId: id.sub });
    if (!user) {
      user = await User.findOne({ email: id.email });
      if (user) await User.updateOne({ _id: user._id }, { googleId: id.sub });
    }
    if (!user) {
      user = await User.create({
        name: (id.name || id.email.split('@')[0]).slice(0, 100), email: id.email, googleId: id.sub, hasPassword: false,
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12), // unusable until they choose a password
      });
    }
    await ensureUserDefaults(String(user._id));
    res.cookie(COOKIE_NAME, signToken(String(user._id), user.tokenVersion ?? 0), cookieOptions());
    res.redirect(`${env.CLIENT_URL.split(',')[0].replace(/\/$/, '')}/`);
  } catch (e) {
    console.error('[google] sign-in failed', (e as Error).message);
    res.redirect(toLogin('sign_in_failed'));
  }
}

/** Step 2: Google redirects here. Public route — authenticated by the signed state. */
r.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  // The same address is used for "Sign in with Google" and for connecting Calendar/Drive; the signed state says which
  let purpose: string | undefined, nonce = '';
  try { const p = jwt.verify(state ?? '', env.JWT_SECRET) as { purpose: string; n?: string }; purpose = p.purpose; nonce = p.n ?? ''; } catch { /* handled below */ }
  if (purpose === 'google-login') {
    if (error) return res.redirect(toLogin(error));
    return finishGoogleLogin(req, res, code, nonce);
  }
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
