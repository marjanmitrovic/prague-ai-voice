import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

function fixHtml(html: string): string {
  return html
    .replace(/2\.[0-9]+\.[0-9]+/g, '4.9.2')
    .replace(/3\.[0-9]+\.[0-9]+/g, '4.9.2')
    .replace(/4\.[0-9]+\.[0-9]+/g, '4.9.2')
    .replace(/\s+target="_blank"\s+rel="noreferrer"/g, '')
    .replace(/\s+rel="noreferrer"\s+target="_blank"/g, '');
}

async function sendTelephonySetupPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'telephony-setup.html');
    const html = fixHtml(await readFile(filePath, 'utf8'));
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
