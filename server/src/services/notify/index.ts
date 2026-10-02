import webpush from 'web-push';
import { env } from '../../config/env.js';
import { AppConfig, NotificationLog, PushSubscription, Settings, User } from '../../models/index.js';
import { computeAlerts, alertKey, type Alert } from '../alerts.js';
import { emailService } from '../email.js';
import { todayIn } from '../../utils/dates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const emailConfigured = () => Boolean(env.SMTP_HOST);
const appUrl = () => env.CLIENT_URL.split(',')[0].replace(/\/$/, '');

// ------------------------------------------------------------------ web push keys
let vapid: { publicKey: string; privateKey: string } | null = null;
export async function getVapid() {
  if (vapid) return vapid;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  else {
    const stored = await AppConfig.findOne({ key: 'vapid' }).lean();
    if (stored?.value?.publicKey) vapid = stored.value;
    else {
      const keys = webpush.generateVAPIDKeys();
      await AppConfig.updateOne({ key: 'vapid' }, { $setOnInsert: { key: 'vapid', value: keys } }, { upsert: true });
      vapid = (await AppConfig.findOne({ key: 'vapid' }).lean())!.value;
    }
  }
  return vapid!;
}

// Swappable senders so tests never touch the network
type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;
type EmailSender = (to: string, subject: string, text: string, html?: string) => Promise<void>;
const defaultPush: PushSender = async (sub, payload) => {
  const v = await getVapid();
  await webpush.sendNotification(sub, payload, { vapidDetails: { subject: `mailto:${env.SMTP_FROM.match(/<(.+)>/)?.[1] ?? 'admin@example.com'}`, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 12 * 3600 });
};
let pushSender: PushSender = defaultPush;
let emailSender: EmailSender = (to, subject, text, html) => emailService.send(to, subject, text, html);
export const setNotifySenders = (s: { push?: PushSender | null; email?: EmailSender | null }) => {
  if (s.push !== undefined) pushSender = s.push ?? defaultPush;
  if (s.email !== undefined) emailSender = s.email ?? ((to, subject, text, html) => emailService.send(to, subject, text, html));
};

// ------------------------------------------------------------------ helpers
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One notification per alert "stage": bills re-notify as they move from "in 3 days" to "today"; budget-type alerts once a month. */
export { alertKey };

async function once(userId: string, channel: 'email' | 'push', key: string): Promise<boolean> {
  try {
    await NotificationLog.create({ userId, channel, key });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

export function buildDigest(name: string, today: string, alerts: Alert[]) {
  const pretty = new Date(today + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const groups: [string, Alert['type'][]][] = [['Bills', ['bill']], ['Invoices', ['invoice']], ['Work', ['job']], ['Tasks', ['task']], ['Budget & income', ['budget', 'income', 'savings']]];
  const subject = `Personal Tracker: ${alerts.length} thing${alerts.length === 1 ? '' : 's'} to know for ${pretty}`;
  const textParts: string[] = [`Hi ${name},`, '', `Here's your summary for ${pretty}.`, ''];
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#0f172a"><h2 style="color:#4f46e5;margin-bottom:4px">Your day at a glance</h2><p style="color:#64748b;margin-top:0">${esc(pretty)}</p>`;
  for (const [label, types] of groups) {
    const items = alerts.filter((a) => types.includes(a.type));
    if (!items.length) continue;
    textParts.push(`${label}:`);
    html += `<h3 style="margin:18px 0 6px;font-size:15px">${label}</h3><ul style="padding-left:18px;margin:0">`;
    for (const a of items) {
      textParts.push(`  - ${a.title}${a.message ? ` — ${a.message}` : ''}`);
      const color = a.severity === 'error' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : '#0f172a';
      html += `<li style="margin:4px 0"><span style="color:${color};font-weight:600">${esc(a.title)}</span>${a.message ? ` <span style="color:#64748b">— ${esc(a.message)}</span>` : ''}</li>`;
    }
    textParts.push('');
    html += '</ul>';
  }
  textParts.push(`Open the app: ${appUrl()}`, '', 'You can turn this email off in Settings → Notifications.');
  html += `<p style="margin-top:22px"><a href="${appUrl()}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Personal Tracker</a></p><p style="color:#94a3b8;font-size:12px">You can turn this email off in Settings → Notifications.</p></div>`;
  return { subject, text: textParts.join('\n'), html };
}

export async function sendPush(userId: string, payload: { title: string; body?: string; url?: string; tag?: string }) {
  const subs = await PushSubscription.find({ userId }).lean();
  let sent = 0;
  for (const s of subs) {
    try {
      await pushSender({ endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh, auth: s.keys!.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e: any) {
      // The browser unsubscribed or the subscription expired
      if ([404, 410].includes(e?.statusCode)) await PushSubscription.deleteOne({ _id: s._id });
      else console.error('[push]', e?.statusCode ?? '', e?.body ?? e?.message ?? e);
    }
  }
  return sent;
}

const localHour = (tz: string, now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));

/** Sends what is due for one user right now: the daily email (once) and new phone notifications (once each). */
export async function runNotifications(userId: string, now = new Date()) {
  const [user, settings] = await Promise.all([User.findById(userId).lean(), Settings.findOne({ userId }).lean()]);
  const n: any = settings?.notifications ?? {};
  const result = { email: false, push: 0 };
  if (!user || (!n.emailEnabled && !n.pushEnabled)) return result;
  const tz = user.timezone || 'Australia/Adelaide';
  const today = todayIn(tz, now);
  const hour = localHour(tz, now);
  const alerts = await computeAlerts(userId, today, user.currency || 'AUD');

  if (n.emailEnabled && emailConfigured() && hour >= (n.emailHour ?? 7) && (await once(userId, 'email', `digest|${today}`))) {
    if (alerts.length) {
      const d = buildDigest(user.name.split(' ')[0], today, alerts);
      try {
        await emailSender(user.email, d.subject, d.text, d.html);
        result.email = true;
      } catch (e) {
        console.error('[email digest]', (e as Error).message);
        await NotificationLog.deleteOne({ userId, channel: 'email', key: `digest|${today}` }); // try again next tick
      }
    }
  }

  // Phone notifications only during the day (7am–9pm local)
  if (n.pushEnabled && hour >= 7 && hour < 21 && (await PushSubscription.exists({ userId }))) {
    const fresh: Alert[] = [];
    for (const a of alerts) if (await once(userId, 'push', alertKey(a, today))) fresh.push(a);
    if (fresh.length > 4) {
      result.push = await sendPush(userId, { title: `${fresh.length} new reminders`, body: fresh.slice(0, 4).map((a) => a.title).join(' · '), url: '/', tag: 'summary' }) ? fresh.length : 0;
    } else {
      for (const a of fresh) if (await sendPush(userId, { title: a.title, body: a.message, url: a.link ?? '/', tag: a.id })) result.push++;
    }
  }
  return result;
}
