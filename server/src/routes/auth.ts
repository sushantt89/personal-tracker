import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { requireAuth, signToken, cookieOptions, COOKIE_NAME } from '../middleware/auth.js';
import { badRequest, conflict, unauthorized } from '../utils/httpError.js';
import { ensureUserDefaults } from '../services/defaults.js';
import { sendUserEmail } from '../services/email.js';
import { env } from '../config/env.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, please try again later' } });

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const email = z.string().trim().toLowerCase().email('Enter a valid email');

r.post('/register', limiter, async (req, res) => {
  const body = parseBody(z.object({ name: z.string().trim().min(1, 'Name is required').max(100), email, password, timezone: z.string().max(60).optional() }), req.body);
  if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists');
  const user = await User.create({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12), timezone: body.timezone || 'Australia/Adelaide' });
  await ensureUserDefaults(String(user._id));
  res.cookie(COOKIE_NAME, signToken(String(user._id), user.tokenVersion ?? 0), cookieOptions());
  res.status(201).json({ user: user.toJSON() });
});

r.post('/login', limiter, async (req, res) => {
  const body = parseBody(z.object({ email, password: z.string().min(1).max(128) }), req.body);
  const user = await User.findOne({ email: body.email }).select('+passwordHash');
  // Same error for unknown email and wrong password
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw unauthorized('Incorrect email or password');
  await ensureUserDefaults(String(user._id));
  res.cookie(COOKIE_NAME, signToken(String(user._id), user.tokenVersion ?? 0), cookieOptions());
  res.json({ user: user.toJSON() });
});

r.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw unauthorized();
  res.json({ user: user.toJSON() });
});

r.patch('/me', requireAuth, async (req, res) => {
  const body = parseBody(
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      email: email.optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone').optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
    }),
    req.body,
  );
  if (body.email && (await User.exists({ email: body.email, _id: { $ne: req.userId } }))) throw conflict('Email already in use');
  const user = await User.findByIdAndUpdate(req.userId, body, { new: true, runValidators: true });
  res.json({ user: user?.toJSON() });
});

r.post('/change-password', requireAuth, limiter, async (req, res) => {
  const body = parseBody(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
  const user = await User.findById(req.userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(body.newPassword, 12);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // sign out other sessions
  await user.save();
  res.cookie(COOKIE_NAME, signToken(String(user._id), user.tokenVersion), cookieOptions());
  res.json({ ok: true });
});

r.post('/forgot-password', limiter, async (req, res) => {
  const body = parseBody(z.object({ email }), req.body);
  const user = await User.findOne({ email: body.email });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    const link = `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
    try {
      await sendUserEmail(String(user._id), user.email, 'Reset your Personal Tracker password', `Use this link within 1 hour to reset your password:\n\n${link}\n\nIf you didn't request this, ignore this email.`);
    } catch (e) {
      // Never reveal whether the account exists or whether delivery worked; the link is still in the server log for the owner
      console.error('[password reset] email could not be sent:', (e as Error).message);
      console.log(`[password reset] link for ${user.email}: ${link}`);
    }
  }
  // Always the same response, so emails can't be enumerated
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

r.post('/reset-password', limiter, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(20).max(200), password }), req.body);
  const hash = crypto.createHash('sha256').update(body.token).digest('hex');
  const user = await User.findOne({ resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!user) throw badRequest('This reset link is invalid or has expired');
  user.passwordHash = await bcrypt.hash(body.password, 12);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  res.json({ ok: true });
});

export default r;
