import nodemailer from 'nodemailer';
import { env } from './config/env.js';
import { logger } from './logging/logger.js';
import type { StoredBooking } from './business/bookings.js';
import { getBusinessProfile } from './business/business-profile.js';

export function emailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

function bookingText(booking: StoredBooking): string {
  const profile = getBusinessProfile(booking.businessSlug);
  const lines = [
    `Rezervace: ${profile.companyName}`,
    '',
    `Služba: ${booking.serviceName}`,
    `Datum: ${booking.date}`,
    `Čas: ${booking.time}`,
    `Jméno: ${booking.customerName}`,
    `Telefon: ${booking.customerPhone}`,
  ];
  if (booking.customerEmail) lines.push(`E-mail: ${booking.customerEmail}`);
  if (booking.note) lines.push(`Poznámka: ${booking.note}`);
  lines.push('', 'Toto je automatické potvrzení z Prague AI Voice demo systému.');
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bookingHtml(booking: StoredBooking): string {
  const profile = getBusinessProfile(booking.businessSlug);
  const row = (label: string, value: string | undefined) => value ? `<tr><td style="padding:8px 12px;color:#64748b">${escapeHtml(label)}</td><td style="padding:8px 12px;font-weight:700">${escapeHtml(value)}</td></tr>` : '';
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dbe5f4;border-radius:18px;padding:24px">
      <h1 style="margin:0 0 8px;font-size:28px">Rezervace přijata</h1>
      <p style="color:#64748b;margin:0 0 18px">${escapeHtml(profile.companyName)}</p>
      <table style="width:100%;border-collapse:collapse;background:#fbfdff;border-radius:12px;overflow:hidden">
        ${row('Služba', booking.serviceName)}
        ${row('Datum', booking.date)}
        ${row('Čas', booking.time)}
        ${row('Jméno', booking.customerName)}
        ${row('Telefon', booking.customerPhone)}
        ${row('E-mail', booking.customerEmail)}
        ${row('Poznámka', booking.note)}
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:18px">Toto je automatické potvrzení z Prague AI Voice demo systému.</p>
    </div>
  </body></html>`;
}

async function sendMail(to: string, subject: string, booking: StoredBooking): Promise<void> {
  if (!emailConfigured()) return;
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text: bookingText(booking),
    html: bookingHtml(booking),
  });
}

export async function sendBookingConfirmationEmails(booking: StoredBooking): Promise<{ configured: boolean; ownerSent: boolean; customerSent: boolean }> {
  const result = { configured: emailConfigured(), ownerSent: false, customerSent: false };
  if (!result.configured) return result;

  const profile = getBusinessProfile(booking.businessSlug);
  const subject = `Nová rezervace: ${booking.serviceName} ${booking.date} ${booking.time}`;

  try {
    if (env.BUSINESS_OWNER_EMAIL) {
      await sendMail(env.BUSINESS_OWNER_EMAIL, subject, booking);
      result.ownerSent = true;
    }
    if (booking.customerEmail) {
      await sendMail(booking.customerEmail, `Potvrzení rezervace: ${profile.companyName}`, booking);
      result.customerSent = true;
    }
  } catch (error) {
    logger.warn({ error, bookingId: booking.id }, 'Booking confirmation email failed');
  }

  return result;
}
