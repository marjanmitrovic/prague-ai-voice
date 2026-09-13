import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

const publicDir = path.resolve(process.cwd(), 'public');
const APP_VERSION = '4.9.2';
const ADMIN_COOKIE_NAME = 'pav_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function safePublicPath(relativePath: string): string | null {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  const absolutePath = path.resolve(publicDir, normalized);
  if (!absolutePath.startsWith(publicDir + path.sep) && absolutePath !== publicDir) return null;
  return absolutePath;
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : header || '';
  return raw.split(';').reduce<Record<string, string>>((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function adminPasswordConfigured(): boolean {
  return Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8);
}

function signAdminSession(exp: number): string {
  return createHmac('sha256', env.ADMIN_PASSWORD || 'missing-admin-password')
    .update(String(exp))
    .digest('base64url');
}

function createAdminSessionToken(): string {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS;
  return `${exp}.${signAdminSession(exp)}`;
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasAdminSession(request: FastifyRequest): boolean {
  if (!adminPasswordConfigured()) return true;
  const token = parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME];
  if (!token) return false;
  const [expRaw, signature] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !signature) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, signAdminSession(exp));
}

function cookieSecureSuffix(): string {
  return env.NODE_ENV === 'production' ? '; Secure' : '';
}

function setAdminCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(createAdminSessionToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}${cookieSecureSuffix()}`,
  );
}

function clearAdminCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureSuffix()}`);
}

function redirectToAdminLogin(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const next = encodeURIComponent(request.url || '/admin');
  return reply.redirect(`/admin-login?next=${next}`, 302);
}

function alignVersions(html: string): string {
  return html
    .replace(/2\.[0-9]+\.[0-9]+/g, APP_VERSION)
    .replace(/3\.[0-9]+\.[0-9]+/g, APP_VERSION)
    .replace(/4\.[0-9]+\.[0-9]+/g, APP_VERSION)
    .replace(/Jedno pitanje po řádku\./g, 'Jedna otázka na řádek.');
}

function removeNewTabNavigation(html: string): string {
  return html
    .replace(/\s+target="_blank"\s+rel="noreferrer"/g, '')
    .replace(/\s+rel="noreferrer"\s+target="_blank"/g, '')
    .replace(/href="\/"(>Ovládací panel<\/a>)/g, 'href="/admin"$1');
}

function applyRuntimeHtmlFixes(relativePath: string, file: Buffer): Buffer {
  if (!relativePath.endsWith('.html')) return file;

  let html = removeNewTabNavigation(alignVersions(file.toString('utf8')));

  if (relativePath === 'index.html') {
    const demoScenarioScript = `
    const storedDemoQuestions = sessionStorage.getItem('pragueAiVoiceDemoQuestions');
    if (storedDemoQuestions) {
      textInput.value = storedDemoQuestions;
      sessionStorage.removeItem('pragueAiVoiceDemoQuestions');
      setTimeout(() => document.getElementById('demoAgent')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }

    loadProfile();`;

    html = html
      .replace(/<a href="#demoVoice">Test českého hlasu<\/a>/g, '<a href="#demoVoice">Test českého hlasu</a>\n        <a href="/demo-scenarios">Demo scénáře</a>\n        <a href="/sales-presentation">Prodejní prezentace</a>\n        <a href="/phone-connection">Telefonní napojení</a>\n        <a href="/admin-login">Admin</a>')
      .replace(/<a href="\/website-import">Import z webu<\/a>/g, '<a href="/admin-login">Admin</a>')
      .replace(/\n\s*loadProfile\(\);\s*\n\s*<\/script>/, `${demoScenarioScript}\n  </script>`);
  }

  return Buffer.from(html, 'utf8');
}

async function sendPublicFile(reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
  const absolutePath = safePublicPath(relativePath);
  if (!absolutePath) return reply.code(404).send({ error: 'not_found' });

  try {
    const rawFile = await readFile(absolutePath);
    const file = applyRuntimeHtmlFixes(relativePath, rawFile);
    const extension = path.extname(absolutePath).toLowerCase();
    const type = contentTypes[extension] ?? 'application/octet-stream';
    if (extension === '.html') reply.header('Cache-Control', 'no-store, max-age=0');
    return reply.type(type).send(file);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

async function sendAdminFile(request: FastifyRequest, reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
  if (!hasAdminSession(request)) return redirectToAdminLogin(request, reply);
  return sendPublicFile(reply, relativePath);
}

export async function staticRoute(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => sendPublicFile(reply, 'index.html'));
  app.get('/sales', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/landing', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/cs', async (_request, reply) => sendPublicFile(reply, 'landing.html'));

  app.get('/favicon.svg', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.svg'));
  app.get('/favicon.png', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.png'));
  app.get('/site.webmanifest', async (_request, reply) => sendPublicFile(reply, 'site.webmanifest'));
  app.get('/assets/*', async (request: FastifyRequest<{ Params: { '*': string } }>, reply) => sendPublicFile(reply, `assets/${request.params['*']}`));

  app.get('/admin-login', async (_request, reply) => sendPublicFile(reply, 'admin-login.html'));
  app.post('/api/admin/session', async (request: FastifyRequest<{ Body: { password?: string } }>, reply) => {
    if (!adminPasswordConfigured()) return reply.code(503).send({ ok: false, error: 'admin_password_not_configured', message: 'ADMIN_PASSWORD není nastaveno.' });
    const password = request.body?.password || '';
    if (!safeEqual(password, env.ADMIN_PASSWORD || '')) return reply.code(401).send({ ok: false, error: 'invalid_password', message: 'Chybné administrátorské heslo.' });
    setAdminCookie(reply);
    return { ok: true };
  });
  app.post('/api/admin/logout', async (_request, reply) => {
    clearAdminCookie(reply);
    return { ok: true };
  });

  app.get('/admin', async (request, reply) => sendAdminFile(request, reply, 'admin.html'));
  app.get('/dashboard', async (request, reply) => sendAdminFile(request, reply, 'admin.html'));
  app.get('/admin-dashboard', async (request, reply) => sendAdminFile(request, reply, 'admin.html'));

  app.get('/client-onboarding-pack', async (request, reply) => sendAdminFile(request, reply, 'client-onboarding-pack.html'));
  app.get('/admin/client-onboarding-pack', async (request, reply) => sendAdminFile(request, reply, 'client-onboarding-pack.html'));
  app.get('/client-setup-pack', async (request, reply) => sendAdminFile(request, reply, 'client-onboarding-pack.html'));

  app.get('/voice-webhook-test', async (request, reply) => sendAdminFile(request, reply, 'voice-webhook-test.html'));
  app.get('/admin/voice-webhook-test', async (request, reply) => sendAdminFile(request, reply, 'voice-webhook-test.html'));
  app.get('/voice-test', async (request, reply) => sendAdminFile(request, reply, 'voice-webhook-test.html'));

  app.get('/production-checklist', async (request, reply) => sendAdminFile(request, reply, 'production-checklist.html'));
  app.get('/admin/production-checklist', async (request, reply) => sendAdminFile(request, reply, 'production-checklist.html'));
  app.get('/setup-checklist', async (request, reply) => sendAdminFile(request, reply, 'production-checklist.html'));

  app.get('/call-leads', async (request, reply) => sendAdminFile(request, reply, 'call-leads.html'));
  app.get('/admin/call-leads', async (request, reply) => sendAdminFile(request, reply, 'call-leads.html'));
  app.get('/missed-calls', async (request, reply) => sendAdminFile(request, reply, 'call-leads.html'));

  app.get('/phone-connection', async (_request, reply) => sendPublicFile(reply, 'phone-connection.html'));
  app.get('/admin/phone-connection', async (request, reply) => sendAdminFile(request, reply, 'phone-connection.html'));
  app.get('/telephony', async (_request, reply) => sendPublicFile(reply, 'phone-connection.html'));

  app.get('/sales-presentation', async (_request, reply) => sendPublicFile(reply, 'sales-presentation.html'));
  app.get('/admin/sales-presentation', async (request, reply) => sendAdminFile(request, reply, 'sales-presentation.html'));
  app.get('/presentation', async (_request, reply) => sendPublicFile(reply, 'sales-presentation.html'));

  app.get('/demo-scenarios', async (_request, reply) => sendPublicFile(reply, 'demo-scenarios.html'));
  app.get('/admin/demo-scenarios', async (request, reply) => sendAdminFile(request, reply, 'demo-scenarios.html'));

  app.get('/unknown-questions', async (request, reply) => sendAdminFile(request, reply, 'unknown-questions.html'));
  app.get('/admin/unknown-questions', async (request, reply) => sendAdminFile(request, reply, 'unknown-questions.html'));
  app.get('/tts-test', async (request, reply) => sendAdminFile(request, reply, 'tts-test.html'));
  app.get('/admin/tts-test', async (request, reply) => sendAdminFile(request, reply, 'tts-test.html'));
  app.get('/admin/website-import', async (request, reply) => sendAdminFile(request, reply, 'website-import.html'));
  app.get('/website-import', async (request, reply) => sendAdminFile(request, reply, 'website-import.html'));
  app.get('/admin/weaknesses', async (request, reply) => sendAdminFile(request, reply, 'weaknesses.html'));
  app.get('/weaknesses', async (request, reply) => sendAdminFile(request, reply, 'weaknesses.html'));
  app.get('/admin/clients', async (request, reply) => sendAdminFile(request, reply, 'clients.html'));
  app.get('/clients', async (request, reply) => sendAdminFile(request, reply, 'clients.html'));
  app.get('/onboarding', async (request, reply) => sendAdminFile(request, reply, 'onboarding.html'));
  app.get('/admin/onboarding', async (request, reply) => sendAdminFile(request, reply, 'onboarding.html'));

  app.get('/booking', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking.html', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking/:businessSlug', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
}
