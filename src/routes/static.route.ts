import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const publicDir = path.resolve(process.cwd(), 'public');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function safePublicPath(relativePath: string): string | null {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  const absolutePath = path.resolve(publicDir, normalized);
  if (!absolutePath.startsWith(publicDir + path.sep) && absolutePath !== publicDir) {
    return null;
  }
  return absolutePath;
}

async function sendPublicFile(reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
  const absolutePath = safePublicPath(relativePath);
  if (!absolutePath) {
    return reply.code(404).send({ error: 'not_found' });
  }

  try {
    const file = await readFile(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const type = contentTypes[extension] ?? 'application/octet-stream';
    return reply.type(type).send(file);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function staticRoute(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => sendPublicFile(reply, 'index.html'));

  app.get('/sales', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/landing', async (_request, reply) => sendPublicFile(reply, 'landing.html'));
  app.get('/cs', async (_request, reply) => sendPublicFile(reply, 'landing.html'));

  app.get('/favicon.svg', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.svg'));
  app.get('/favicon.png', async (_request, reply) => sendPublicFile(reply, 'assets/favicon.png'));
  app.get('/site.webmanifest', async (_request, reply) => sendPublicFile(reply, 'site.webmanifest'));
  app.get('/assets/*', async (request: FastifyRequest<{ Params: { '*': string } }>, reply) => {
    return sendPublicFile(reply, `assets/${request.params['*']}`);
  });

  app.get('/admin/clients', async (_request, reply) => sendPublicFile(reply, 'clients.html'));
  app.get('/clients', async (_request, reply) => sendPublicFile(reply, 'clients.html'));

  app.get('/onboarding', async (_request, reply) => sendPublicFile(reply, 'onboarding.html'));
  app.get('/admin/onboarding', async (_request, reply) => sendPublicFile(reply, 'onboarding.html'));

  app.get('/booking', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking.html', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
  app.get('/booking/:businessSlug', async (_request, reply) => sendPublicFile(reply, 'booking.html'));
}
