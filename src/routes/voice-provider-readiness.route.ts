import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

async function sendVoiceProviderReadinessPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'voice-provider-readiness.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function voiceProviderReadinessRoute(app: FastifyInstance): Promise<void> {
  app.get('/voice-provider-readiness', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendVoiceProviderReadinessPage(reply);
  });

  app.get('/admin/voice-provider-readiness', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendVoiceProviderReadinessPage(reply);
  });

  app.get('/provider-readiness', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendVoiceProviderReadinessPage(reply);
  });
}
