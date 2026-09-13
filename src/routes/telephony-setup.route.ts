import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

function prepareTelephonySetupHtml(html: string): string {
  const directSlugScript = `
    const initialBusinessSlug = new URLSearchParams(location.search).get('businessSlug');
    if (initialBusinessSlug) {
      $('businessSlug').value = initialBusinessSlug;
    }
    buildSetup();`;

  return html
    .replace(/4\.[0-9]+\.[0-9]+/g, '5.1.0')
    .replace(/target="_blank" rel="noreferrer"/g, '')
    .replace(/target="_blank"/g, '')
    .replace(/rel="noreferrer"/g, '')
    .replace(/\n\s*buildSetup\(\);\s*\n\s*<\/script>/, `${directSlugScript}\n  </script>`);
}

async function sendTelephonySetupPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'telephony-setup.html');
    const html = prepareTelephonySetupHtml(await readFile(filePath, 'utf8'));
    return reply.header('Cache-Control', 'no-store, max-age=0').type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function telephonySetupRoute(app: FastifyInstance): Promise<void> {
  app.get('/telephony-setup', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendTelephonySetupPage(reply);
  });

  app.get('/admin/telephony-setup', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendTelephonySetupPage(reply);
  });

  app.get('/phone-setup', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendTelephonySetupPage(reply);
  });
}
