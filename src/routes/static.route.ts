import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const publicDir = path.resolve(process.cwd(), 'public');
const APP_VERSION = '3.3.0';

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
  '.ico': 'image/x-icon'
};

function safePublicPath(relativePath: string): string | null {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  const absolutePath = path.resolve(publicDir, normalized);
  if (!absolutePath.startsWith(publicDir + path.sep) && absolutePath !== publicDir) {
    return null;
  }
  return absolutePath;
}

function applyRuntimeHtmlFixes(relativePath: string, file: Buffer): Buffer {
  if (relativePath !== 'index.html') return file;

  const demoScenarioScript = `
    const storedDemoQuestions = sessionStorage.getItem('pragueAiVoiceDemoQuestions');
    if (storedDemoQuestions) {
      textInput.value = storedDemoQuestions;
      sessionStorage.removeItem('pragueAiVoiceDemoQuestions');
      setTimeout(() => document.getElementById('demoAgent')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }

    loadProfile();`;

  const html = file.toString('utf8')
    .replace(/2\.1\.4/g, APP_VERSION)
    .replace(/2\.1\.5/g, APP_VERSION)
    .replace(/2\.1\.6/g, APP_VERSION)
    .replace(/2\.2\.0/g, APP_VERSION)
    .replace(/2\.2\.1/g, APP_VERSION)
    .replace(/2\.3\.0/g, APP_VERSION)
    .replace(/2\.3\.1/g, APP_VERSION)
    .replace(/2\.4\.0/g, APP_VERSION)
    .replace(/2\.5\.0/g, APP_VERSION)
    .replace(/2\.5\.1/g, APP_VERSION)
    .replace(/2\.6\.0/g, APP_VERSION)
    .replace(/2\.7\.0/g, APP_VERSION)
    .replace(/2\.8\.0/g, APP_VERSION)
    .replace(/3\.0\.0/g, APP_VERSION)
    .replace(/3\.1\.0/g, APP_VERSION)
    .replace(/3\.2\.0/g, APP_VERSION)
    .replace(/Jedno pitanje po řádku\./g, 'Jedna otázka na řádek.')
    .replace(/<a href="#demoVoice">Test českého hlasu<\/a>/g, '<a href="#demoVoice">Test českého hlasu</a>\n        <a href="/demo-scenarios" target="_blank" rel="noreferrer">Demo scénáře</a>\n        <a href="/sales-presentation" target="_blank" rel="noreferrer">Prodejní prezentace</a>\n        <a href="/phone-connection" target="_blank" rel="noreferrer">Telefonní napojení</a>\n        <a href="/call-leads" target="_blank" rel="noreferrer">Zmeškané hovory</a>\n        <a href="/production-checklist" target="_blank" rel="noreferrer">Produkční kontrola</a>')
    .replace(/<a href="\/website-import" target="_blank" rel="noreferrer">Import z webu<\/a>/g, '<a href="/website-import" target="_blank" rel="noreferrer">Import z webu</a>\n          <a href="/demo-scenarios" target="_blank" rel="noreferrer">Demo scénáře</a>\n          <a href="/sales-presentation" target="_blank" rel="noreferrer">Prodejní prezentace</a>\n          <a href="/phone-connection" target="_blank" rel="noreferrer">Telefonní napojení</a>\n          <a href="/call-leads" target="_blank" rel="noreferrer">Zmeškané hovory</a>\n          <a href="/production-checklist" target="_blank" rel="noreferrer">Produkční kontrola</a>')
    .replace(/\n\s*loadProfile\(\);\s*\n\s*<\/script>/, `${demoScenarioScript}\n  </script>`);

  return Buffer.from(html, 'utf8');
}

async function sendPublicFile(reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
  const absolutePath = safePublicPath(relativePath);
  if (!absolutePath) {
    return reply.code(404).send({ error: 'not_found' });
  }

  try {
    const rawFile = await readFile(absolutePath);
    const file = applyRuntimeHtmlFixes(relativePath, rawFile);
    const extension = path.extname(absolutePath).toLowerCase();
    const type = contentTypes[extension] ?? 'application/octet-stream';
    return reply.type(type).send(file);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function staticRoute(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => sendPublicFile(reply, 'index.html'));

  app.get('/sales', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/landing', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/cs', async (_request, reply) => sendPublicFile(reply, 'landing.html'));

  app.get('/favicon.svg', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.svg'));
  app.get('/favicon.png', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.png'));
  app.get('/site.webmanifest', async (_request, reply) => sendPublicFile(reply, 'site.webmanifest'));
  app.get('/assets/*', async (request: FastifyRequest<{ Params: { '*': string } }>, reply) => {
    return sendPublicFile(reply, `assets/${request.params['*']}`);
  });

  app.get('/production-checklist', async (_request, reply) => sendPublicFile(reply, 'production-checklist.html'));
  app.get('/admin/production-checklist', async (_request, reply) => sendPublicFile(reply, 'production-checklist.html'));
  app.get('/setup-checklist', async (_request, reply) => sendPublicFile(reply, 'production-checklist.html'));

  app.get('/call-leads', async (_request, reply) => sendPublicFile(reply, 'call-leads.html'));
  app.get('/admin/call-leads', async (_request, reply) => sendPublicFile(reply, 'call-leads.html'));
  app.get('/missed-calls', async (_request, reply) => sendPublicFile(reply, 'call-leads.html'));

  app.get('/phone-connection', async (_request, reply) => sendPublicFile(reply, 'phone-connection.html'));
  app.get('/admin/phone-connection', async (_request, reply) => sendPublicFile(reply, 'phone-connection.html'));
  app.get('/telephony', async (_request, reply) => sendPublicFile(reply, 'phone-connection.html'));

  app.get('/sales-presentation', async (_request, reply) => sendPublicFile(reply, 'sales-presentation.html'));
  app.get('/admin/sales-presentation', async (_request, reply) => sendPublicFile(reply, 'sales-presentation.html'));
  app.get('/presentation', async (_request, reply) => sendPublicFile(reply, 'sales-presentation.html'));

  app.get('/demo-scenarios', async (_request, reply) => sendPublicFile(reply, 'demo-scenarios.html'));
  app.get('/admin/demo-scenarios', async (_request, reply) => sendPublicFile(reply, 'demo-scenarios.html'));

  app.get('/unknown-questions', async (_request, reply) => sendPublicFile(reply, 'unknown-questions.html'));
  app.get('/admin/unknown-questions', async (_request, reply) => sendPublicFile(reply, 'unknown-questions.html'));

  app.get('/tts-test', async (_request, reply) => sendPublicFile(reply, 'tts-test.html'));
  app.get('/admin/tts-test', async (_request, reply) => sendPublicFile(reply, 'tts-test.html'));

  app.get('/admin/website-import', async (_request, reply) => sendPublicFile(reply, 'website-import.html'));
  app.get('/website-import', async (_request, reply) => sendPublicFile(reply, 'website-import.html'));

  app.get('/admin/weaknesses', async (_request, reply) => sendPublicFile(reply, 'weaknesses.html'));
  app.get('/weaknesses', async (_request, reply) => sendPublicFile(reply, 'weaknesses.html'));

  app.get('/admin/clients', async (_request, reply) => sendPublicFile(reply, 'clients.html'));
  app.get('/clients', async (_request, reply) => sendPublicFile(reply, 'clients.html'));

  app.get('/onboarding', async (_request, reply) => sendPublicFile(reply, 'onboarding.html'));
  app.get('/admin/onboarding', async (_request, reply) => sendPublicFile(reply, 'onboarding.html'));

  app.get('/booking', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking.html', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking/:businessSlug', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
}
