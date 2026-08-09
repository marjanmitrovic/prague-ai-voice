import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export type CallLeadEmailInput = {
  id: string;
  businessSlug: string;
  status: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  message: string;
  source: string;
  createdAt: string;
};

export type CallLeadEmailResult = {
  sent: boolean;
  skipped: boolean;
  provider?: 'brevo' | 'smtp';
  reason?: string;
  messageId?: string;
};

function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.BUSINESS_OWNER_EMAIL);
}

function brevoConfigured(): boolean {
  return Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL && env.BUSINESS_OWNER_EMAIL);
}

export function callLeadEmailConfigured(): boolean {
  if (env.EMAIL_PROVIDER === 'brevo') return brevoConfigured();
  if (env.EMAIL_PROVIDER === 'smtp') return smtpConfigured();
  return brevoConfigured() || smtpConfigured();
}

function selectedProvider(): 'brevo' | 'smtp' | null {
  if (env.EMAIL_PROVIDER === 'brevo') return brevoConfigured() ? 'brevo' : null;
  if (env.EMAIL_PROVIDER === 'smtp') return smtpConfigured() ? 'smtp' : null;
  if (brevoConfigured()) return 'brevo';
  if (smtpConfigured()) return 'smtp';
  return null;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function telLink(phone: string): string {
  return phone.replace(/[^+0-9]/g, '');
}

function plainText(input: CallLeadEmailInput): string {
  return [
    'Nový zachycený hovor',
    '',
    `Firma: ${input.businessSlug}`,
    `Zákazník: ${input.customerName}`,
    `Telefon: ${input.customerPhone}`,
    `Služba: ${input.serviceName}`,
    `Status: ${input.status}`,
    `Zdroj: ${input.source}`,
    `Čas: ${new Date(input.createdAt).toLocaleString('cs-CZ')}`,
    '',
    'Zpráva:',
    input.message,
    '',
    `Administrace: ${env.PUBLIC_BASE_URL}/call-leads`,
  ].join('\n');
}

function html(input: CallLeadEmailInput): string {
  const phone = telLink(input.customerPhone);
  const adminUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/call-leads`;
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#122033;max-width:680px">
      <h2 style="margin:0 0 12px">Nový zachycený hovor</h2>
      <p style="color:#64748b">AI asistent uložil nový požadavek ze zmeškaného hovoru.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Firma</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee">${escapeHtml(input.businessSlug)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Zákazník</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee">${escapeHtml(input.customerName)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Telefon</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee"><a href="tel:${escapeHtml(phone)}">${escapeHtml(input.customerPhone)}</a></td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Služba</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee">${escapeHtml(input.serviceName)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Status</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee">${escapeHtml(input.status)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe3ee"><b>Čas</b></td><td style="padding:8px;border-bottom:1px solid #dbe3ee">${escapeHtml(new Date(input.createdAt).toLocaleString('cs-CZ'))}</td></tr>
      </table>
      <h3>Zpráva</h3>
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #dbe3ee;border-radius:12px;padding:12px">${escapeHtml(input.message)}</div>
      <p style="margin-top:18px">
        <a href="tel:${escapeHtml(phone)}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;border-radius:12px;padding:10px 14px;font-weight:bold">Zavolat zpět</a>
        <a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#e8eef8;color:#0f172a;text-decoration:none;border-radius:12px;padding:10px 14px;font-weight:bold;margin-left:8px">Otevřít administraci</a>
      </p>
    </div>
  `;
}

function subject(input: CallLeadEmailInput): string {
  return `Nový zmeškaný hovor: ${input.customerName} — ${input.serviceName}`;
}

async function sendViaBrevo(input: CallLeadEmailInput): Promise<CallLeadEmailResult> {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': env.BREVO_API_KEY || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: env.BREVO_SENDER_NAME || 'Prague AI Voice',
        email: env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: env.BUSINESS_OWNER_EMAIL }],
      subject: subject(input),
      textContent: plainText(input),
      htmlContent: html(input),
      tags: ['call-lead', 'missed-call'],
    }),
  });

  const data = await response.json().catch(() => ({})) as { messageId?: string; message?: string; code?: string };
  if (!response.ok) {
    const detail = data.message || data.code || `brevo_http_${response.status}`;
    throw new Error(detail);
  }

  return { sent: true, skipped: false, provider: 'brevo', messageId: data.messageId };
}

async function sendViaSmtp(input: CallLeadEmailInput): Promise<CallLeadEmailResult> {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: env.BUSINESS_OWNER_EMAIL,
    subject: subject(input),
    text: plainText(input),
    html: html(input),
  });

  return { sent: true, skipped: false, provider: 'smtp', messageId: info.messageId };
}

export async function sendCallLeadEmail(input: CallLeadEmailInput): Promise<CallLeadEmailResult> {
  const provider = selectedProvider();
  if (!provider) {
    return { sent: false, skipped: true, reason: 'email_api_or_smtp_not_configured' };
  }

  if (provider === 'brevo') return sendViaBrevo(input);
  return sendViaSmtp(input);
}
