import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

const TELEPHONY_SETUP_VERSION = '5.3.0';

function prepareTelephonySetupHtml(html: string): string {
  const directSlugScript = `
    const initialBusinessSlug = new URLSearchParams(location.search).get('businessSlug');
    if (initialBusinessSlug) {
      $('businessSlug').value = initialBusinessSlug;
    }
    buildSetup();`;

  return html
    .replace(/\d+\.\d+\.\d+ — Telephony Setup Wizard/g, `${TELEPHONY_SETUP_VERSION} — Telephony Setup Wizard`)
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
