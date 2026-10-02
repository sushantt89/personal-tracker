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
