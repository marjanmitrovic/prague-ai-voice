import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

async function sendTelephonySetupPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'telephony-setup.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
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
