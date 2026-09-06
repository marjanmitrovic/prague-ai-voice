import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';
import { listClientActivity } from '../client-activity-log.js';
import { safeBusinessSlug } from '../storage-postgres.js';

function queryBusinessSlug(query: unknown): string | undefined {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return value ? safeBusinessSlug(value) : undefined;
}

async function sendActivityPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'client-activity.html');
    const html = await readFile(filePath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function clientActivityRoute(app: FastifyInstance): Promise<void> {
  app.get('/client-activity', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendActivityPage(reply);
  });

  app.get('/admin/client-activity', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendActivityPage(reply);
  });

  app.get('/activity-log', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendActivityPage(reply);
  });

  app.get('/api/client-activity', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = queryBusinessSlug(request.query);
    return { ok: true, businessSlug: businessSlug ?? null, activity: listClientActivity(businessSlug) };
  });
}
