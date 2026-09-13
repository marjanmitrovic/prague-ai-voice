import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

async function sendPublicAsset(reply: FastifyReply, relativePath: string, contentType: string): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', relativePath);
    const file = await readFile(filePath);
    return reply.type(contentType).send(file);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

async function sendAdminApp(reply: FastifyReply): Promise<FastifyReply> {
  return sendPublicAsset(reply, 'admin-app.html', 'text/html; charset=utf-8');
}

export async function adminPwaRoute(app: FastifyInstance): Promise<void> {
  app.get('/admin-app', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendAdminApp(reply);
  });

  app.get('/mobile-admin', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendAdminApp(reply);
  });

  app.get('/admin.webmanifest', async (_request, reply) => {
    return sendPublicAsset(reply, 'admin.webmanifest', 'application/manifest+json; charset=utf-8');
  });

  app.get('/admin-sw.js', async (_request, reply) => {
    return reply
      .header('Service-Worker-Allowed', '/')
      .header('Cache-Control', 'no-cache')
      .type('application/javascript; charset=utf-8')
      .send(await readFile(path.resolve(process.cwd(), 'public', 'admin-sw.js'), 'utf8'));
  });
}
