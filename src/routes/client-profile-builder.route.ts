import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';

async function sendBuilderPage(reply: { type: (contentType: string) => typeof reply; send: (payload: string) => unknown; code: (statusCode: number) => typeof reply }) {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'client-profile-builder.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function clientProfileBuilderRoute(app: FastifyInstance): Promise<void> {
  app.get('/client-profile-builder', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendBuilderPage(reply);
  });

  app.get('/admin/client-profile-builder', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendBuilderPage(reply);
  });

  app.get('/profile-builder', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendBuilderPage(reply);
  });
}
