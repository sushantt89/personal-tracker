import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailAttachment { filename: string; content: Buffer; contentType: string }
export interface EmailExtras { attachments?: EmailAttachment[]; /** name shown as the sender, e.g. the business name on an invoice */ fromName?: string; replyTo?: string }
export interface EmailService {
  send(to: string, subject: string, text: string, html?: string, extras?: EmailExtras): Promise<void>;
}

class ConsoleEmailService implements EmailService {
  async send(to: string, subject: string, text: string) {
    console.log(`\n[email:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
  }
}

class SmtpEmailService implements EmailService {
  private transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  async send(to: string, subject: string, text: string, html?: string, extras?: EmailExtras) {
    await this.transport.sendMail({ from: env.SMTP_FROM, to, subject, text, html, replyTo: extras?.replyTo, attachments: extras?.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) });
  }
}

/** SMTP if configured (e.g. Gmail app password, Brevo free tier), otherwise logs to console. */
export const emailService: EmailService = env.SMTP_HOST ? new SmtpEmailService() : new ConsoleEmailService();

// ---------- Sending for a particular user ----------
import { GoogleAccount } from '../models/index.js';
import { GMAIL_SEND_SCOPE, googleApis, recordGoogleError } from './google/client.js';

export type EmailRoute = 'gmail' | 'smtp' | null;
export const smtpConfigured = () => Boolean(env.SMTP_HOST);

async function gmailAccount(userId: string) {
  const acc = await GoogleAccount.findOne({ userId }).lean();
  return acc && !acc.needsReconnect && (acc.scopes ?? []).includes(GMAIL_SEND_SCOPE) ? acc : null;
}

/** How email will be delivered for this user: their connected Google account, the server's SMTP settings, or not at all. */
export async function emailRoute(userId: string): Promise<EmailRoute> {
  if (override) return 'gmail';
  if (await gmailAccount(userId)) return 'gmail';
  return smtpConfigured() ? 'smtp' : null;
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

/** Tests (and nothing else) can capture outgoing mail instead of sending it. */
type Override = (m: { userId: string; to: string; subject: string; text: string; html?: string; extras?: EmailExtras }) => Promise<void> | void;
let override: Override | null = null;
export const setEmailOverride = (f: Override | null) => { override = f; };

/** Builds a plain-text (+ optional HTML, + optional attachments) email in the format Gmail's API expects. */
export function buildRawEmail(from: string, to: string, subject: string, text: string, html?: string, extras?: EmailExtras): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const head = [`From: ${encodeHeader(clean(extras?.fromName || 'Personal Tracker').replace(/["<>]/g, ''))} <${clean(from)}>`, `To: ${clean(to)}`, ...(extras?.replyTo ? [`Reply-To: ${clean(extras.replyTo)}`] : []), `Subject: ${encodeHeader(clean(subject))}`, 'MIME-Version: 1.0'];
  let body: string[];
  if (html) {
    const boundary = `pt_${Date.now().toString(36)}`;
    body = [`Content-Type: multipart/alternative; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
      `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
      `--${boundary}--`];
  } else {
    body = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text)];
  }
  if (extras?.attachments?.length) {
    // Wrap the message and each file in a multipart/mixed envelope
    const mixed = `ptm_${Date.now().toString(36)}`;
    const files = extras.attachments.flatMap((a) => [
      `--${mixed}`, `Content-Type: ${clean(a.contentType)}; name="${clean(a.filename).replace(/"/g, '')}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${clean(a.filename).replace(/"/g, '')}"`, '', a.content.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    ]);
    body = [`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...body, ...files, `--${mixed}--`];
  }
  return Buffer.from([...head, ...body].join('\r\n'), 'utf8').toString('base64url');
}

export interface SendResult { via: EmailRoute; /** address it was sent from, when known */ from?: string; /** set when Google was tried first and refused */ googleError?: string }

/**
 * Sends an email on behalf of a user and says how it actually went out. Uses their connected Google account when it has
 * permission to send (works on hosts that block mail ports, and the message lands in their Gmail "Sent"), otherwise the
 * server's SMTP settings. `via: null` means nothing was delivered — it was only printed to the server log.
 */
export async function sendUserEmailDetailed(userId: string, to: string, subject: string, text: string, html?: string, extras?: EmailExtras, opts: { /** only ever send from the user's own Google account — never fall back to the server's mail service */ gmailOnly?: boolean } = {}): Promise<SendResult> {
  if (override) { await override({ userId, to, subject, text, html, extras }); return { via: 'gmail' }; }
  const acc = await gmailAccount(userId);
  if (opts.gmailOnly && !acc) throw new Error('Your Google account is not connected with permission to send email');
  let googleError: string | undefined;
  if (acc) {
    try {
      const apis = await googleApis(userId);
      if (apis?.sendMail) {
        await apis.sendMail(buildRawEmail(acc.googleEmail ?? to, to, subject, text, html, extras));
        return { via: 'gmail', from: acc.googleEmail ?? undefined };
      }
      if (opts.gmailOnly) throw new Error('Google sending is not available');
      googleError = 'Google sending is not available';
    } catch (e) {
      await recordGoogleError(userId, e, 'Sending email through Google');
      if (opts.gmailOnly || !smtpConfigured()) throw e;
      googleError = (e as Error).message;
    }
  }
  await emailService.send(to, subject, text, html, extras);
  return smtpConfigured() ? { via: 'smtp', from: env.SMTP_FROM || undefined, googleError } : { via: null, googleError };
}

export async function sendUserEmail(userId: string, to: string, subject: string, text: string, html?: string, extras?: EmailExtras): Promise<EmailRoute> {
  return (await sendUserEmailDetailed(userId, to, subject, text, html, extras)).via;
}
