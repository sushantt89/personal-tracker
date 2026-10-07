import webpush from 'web-push';
import { env } from '../../config/env.js';
import { AppConfig, Job, NotificationLog, PushSubscription, Settings, User } from '../../models/index.js';
import { computeAlerts, alertKey, type Alert } from '../alerts.js';
import { emailRoute, sendUserEmail } from '../email.js';
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
type EmailSender = (to: string, subject: string, text: string, html?: string, userId?: string) => Promise<unknown>;
const defaultEmailSender: EmailSender = (to, subject, text, html, userId) => sendUserEmail(userId!, to, subject, text, html);
const defaultPush: PushSender = async (sub, payload) => {
  const v = await getVapid();
  await webpush.sendNotification(sub, payload, { vapidDetails: { subject: `mailto:${env.SMTP_FROM.match(/<(.+)>/)?.[1] ?? 'admin@example.com'}`, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 12 * 3600 });
};
let pushSender: PushSender = defaultPush;
let emailSender: EmailSender = defaultEmailSender;
export const setNotifySenders = (s: { push?: PushSender | null; email?: EmailSender | null }) => {
  if (s.push !== undefined) pushSender = s.push ?? defaultPush;
  if (s.email !== undefined) emailSender = s.email ?? defaultEmailSender;
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

const localMinutes = (tz: string, now: Date) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  return h * 60 + m;
};
const fmt12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

/** Everything needed at the door for one job: how to get in, what to do, anything to watch for. Nothing from other jobs. */
export function jobBriefing(job: any): { title: string; body: string } {
  const lines: string[] = [];
  const addr = job.address?.formatted || [job.address?.line1, job.address?.suburb].filter(Boolean).join(', ');
  if (addr) lines.push(addr);
  if (job.meetingPoint) lines.push(`Meet: ${job.meetingPoint}`);
  if (job.specialInstructions) lines.push(String(job.specialInstructions).trim());
  if (job.description) lines.push(String(job.description).trim());
  const rooms = [job.rooms ? `${job.rooms} room${job.rooms === 1 ? '' : 's'}` : '', job.bathrooms ? `${job.bathrooms} bathroom${job.bathrooms === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  if (rooms) lines.push(rooms);
  if (job.tasks?.length) lines.push(job.tasks.map((t: string) => `• ${t}`).join('\n'));
  if (job.notes) lines.push(String(job.notes).trim());
  let body = lines.join('\n');
  // Push messages have a small size limit; keep well under it
  if (body.length > 1500) body = `${body.slice(0, 1480).trimEnd()}… (open for the rest)`;
  return { title: `${job.clientName || job.title || 'Job'}${job.startTime ? ` · ${fmt12(job.startTime)}` : ''}`, body: body || 'No instructions were saved for this job.' };
}

/**
 * A phone notification with one job's details, sent as the job is about to start (from 15 minutes before until
 * 20 minutes after its start time), once per job. A web app can't tell when you physically arrive, so the start time stands in for it.
 */
async function sendJobBriefings(userId: string, today: string, nowMinutes: number): Promise<number> {
  const jobs = await Job.find({ userId, date: today, status: { $in: ['scheduled', 'in_progress'] }, startTime: { $exists: true, $ne: null } }).sort({ startTime: 1 }).lean<any[]>();
  let sent = 0;
  for (const job of jobs) {
    if (!/^\d{2}:\d{2}$/.test(job.startTime ?? '')) continue;
    const start = Number(job.startTime.slice(0, 2)) * 60 + Number(job.startTime.slice(3));
    if (nowMinutes < start - 15 || nowMinutes > start + 20) continue;
    if (!(await once(userId, 'push', `job-briefing|${job._id}|${today}|${job.startTime}`))) continue;
    const b = jobBriefing(job);
    if (await sendPush(userId, { title: b.title, body: b.body, url: `/jobs?focus=${job._id}`, tag: `job-briefing-${job._id}` })) sent++;
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

  if (n.emailEnabled && (await emailRoute(userId)) && hour >= (n.emailHour ?? 7) && (await once(userId, 'email', `digest|${today}`))) {
    if (alerts.length) {
      const d = buildDigest(user.name.split(' ')[0], today, alerts);
      try {
        await emailSender(user.email, d.subject, d.text, d.html, userId);
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
  // A job's own details as it is about to start — at any hour, since evening and night work needs them too
  if (n.pushEnabled && n.jobReminders !== false && (await PushSubscription.exists({ userId }))) result.push += await sendJobBriefings(userId, today, localMinutes(tz, now));
  return result;
}
