import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminPasswordConfigured, isAdminRequest } from '../auth.js';

async function sendBuilderPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'client-profile-builder.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

function requireAdminPage(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!adminPasswordConfigured()) {
    reply.code(503).send({ ok: false, error: 'admin_password_not_configured', message: 'ADMIN_PASSWORD není nastaveno.' });
    return false;
  }

  if (!isAdminRequest(request)) {
    const next = encodeURIComponent(request.url || '/client-profile-builder');
    reply.redirect(`/admin-login?next=${next}`, 302);
    return false;
  }

  return true;
}

export async function clientProfileBuilderRoute(app: FastifyInstance): Promise<void> {
  app.get('/client-profile-builder', async (request, reply) => {
    if (!requireAdminPage(request, reply)) return;
    return sendBuilderPage(reply);
  });

  app.get('/admin/client-profile-builder', async (request, reply) => {
    if (!requireAdminPage(request, reply)) return;
    return sendBuilderPage(reply);
  });

  app.get('/profile-builder', async (request, reply) => {
    if (!requireAdminPage(request, reply)) return;
    return sendBuilderPage(reply);
  });
}
