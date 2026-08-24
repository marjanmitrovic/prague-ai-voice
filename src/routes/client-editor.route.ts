import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

async function sendClientEditorPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'client-editor.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function clientEditorRoute(app: FastifyInstance): Promise<void> {
  app.get('/client-editor', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });

  app.get('/admin/client-editor', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });

  app.get('/edit-client', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });
}
