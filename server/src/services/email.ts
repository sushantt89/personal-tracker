import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailService {
  send(to: string, subject: string, text: string, html?: string): Promise<void>;
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
  async send(to: string, subject: string, text: string, html?: string) {
    await this.transport.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
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
  if (await gmailAccount(userId)) return 'gmail';
  return smtpConfigured() ? 'smtp' : null;
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

/** Builds a plain-text (+ optional HTML) email in the format Gmail's API expects. */
export function buildRawEmail(from: string, to: string, subject: string, text: string, html?: string): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const head = [`From: ${encodeHeader('Personal Tracker')} <${clean(from)}>`, `To: ${clean(to)}`, `Subject: ${encodeHeader(clean(subject))}`, 'MIME-Version: 1.0'];
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
  return Buffer.from([...head, ...body].join('\r\n'), 'utf8').toString('base64url');
}

/**
 * Sends an email on behalf of a user. Uses their connected Google account when it has permission to send
 * (works on hosts that block mail ports), otherwise the server's SMTP settings, otherwise prints it to the server log.
 */
export async function sendUserEmail(userId: string, to: string, subject: string, text: string, html?: string): Promise<EmailRoute> {
  const acc = await gmailAccount(userId);
  if (acc) {
    try {
      const apis = await googleApis(userId);
      if (apis?.sendMail) {
        await apis.sendMail(buildRawEmail(acc.googleEmail ?? to, to, subject, text, html));
        return 'gmail';
      }
    } catch (e) {
      await recordGoogleError(userId, e, 'Sending email through Google');
      if (!smtpConfigured()) throw e;
    }
  }
  await emailService.send(to, subject, text, html);
  return smtpConfigured() ? 'smtp' : null;
}
