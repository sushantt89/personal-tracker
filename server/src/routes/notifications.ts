import { Router } from 'express';
import { z } from 'zod';
import { PushSubscription, User, Settings } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest } from '../utils/httpError.js';
import { buildDigest, emailConfigured, getVapid, sendPush } from '../services/notify/index.js';
import { computeAlerts } from '../services/alerts.js';
import { emailService } from '../services/email.js';
import { userCtx } from '../utils/userCtx.js';

const r = Router();

r.get('/status', async (req, res) => {
  const [v, devices, settings] = await Promise.all([getVapid(), PushSubscription.find({ userId: req.userId }).select('userAgent createdAt endpoint').lean(), Settings.findOne({ userId: req.userId }).lean()]);
  res.json({
    emailConfigured: emailConfigured(),
    pushPublicKey: v.publicKey,
    devices: devices.map((d) => ({ id: String(d._id), userAgent: d.userAgent, addedAt: (d as { createdAt?: Date }).createdAt, endpoint: d.endpoint })),
    emailEnabled: Boolean(settings?.notifications?.emailEnabled),
    pushEnabled: Boolean(settings?.notifications?.pushEnabled),
  });
});

const subSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(5).max(100) }) });

/** Register this browser/phone for notifications. */
r.post('/push/subscribe', async (req, res) => {
  const { subscription } = parseBody(z.object({ subscription: subSchema }), req.body);
  await PushSubscription.findOneAndUpdate({ endpoint: subscription.endpoint }, { userId: req.userId, endpoint: subscription.endpoint, keys: subscription.keys, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) }, { upsert: true });
  await Settings.updateOne({ userId: req.userId }, { 'notifications.pushEnabled': true });
  res.status(201).json({ ok: true });
});

r.post('/push/unsubscribe', async (req, res) => {
  const { endpoint } = parseBody(z.object({ endpoint: z.string().max(1000) }), req.body);
  await PushSubscription.deleteOne({ userId: req.userId, endpoint });
  res.json({ ok: true });
});

/** Send a test now so you can check delivery. */
r.post('/test', async (req, res) => {
  const { channel } = parseBody(z.object({ channel: z.enum(['email', 'push']) }), req.body);
  if (channel === 'push') {
    const sent = await sendPush(req.userId!, { title: 'Personal Tracker', body: 'Notifications are working on this device.', url: '/settings?tab=notifications', tag: 'test' });
    if (!sent) throw badRequest('No device is registered yet. Click “Turn on for this device” first.');
    return res.json({ ok: true, sent });
  }
  if (!emailConfigured()) throw badRequest('Email is not set up on the server. Add SMTP_HOST, SMTP_USER and SMTP_PASS to .env (see docs/NOTIFICATIONS.md).');
  const { today, currency } = await userCtx(req);
  const user = await User.findById(req.userId).lean();
  const alerts = await computeAlerts(req.userId!, today, currency);
  const d = buildDigest(user!.name.split(' ')[0], today, alerts.length ? alerts : [{ id: 'test', type: 'task', severity: 'info', title: 'This is a test email', message: 'Your daily summary will look like this.' }]);
  try {
    await emailService.send(user!.email, `[Test] ${d.subject}`, d.text, d.html);
  } catch (e) {
    throw badRequest(`The email could not be sent: ${(e as Error).message}`);
  }
  res.json({ ok: true, to: user!.email });
});

export default r;
