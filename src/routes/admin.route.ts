import type { FastifyInstance } from 'fastify';
import { adminPasswordConfigured, isAdminRequest } from '../auth.js';
import { env } from '../config/env.js';

export async function adminRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/status', async (request) => {
    return {
      ok: true,
      configured: adminPasswordConfigured(),
      authenticated: isAdminRequest(request),
      production: env.NODE_ENV === 'production',
    };
  });

  app.post('/api/admin/login', async (request, reply) => {
    if (!adminPasswordConfigured()) {
      return reply.code(503).send({
        ok: false,
        error: 'admin_password_not_configured',
        message: 'ADMIN_PASSWORD is not configured on the server.',
      });
    }

    if (!isAdminRequest(request)) {
      return reply.code(401).send({
        ok: false,
        error: 'invalid_admin_password',
        message: 'Invalid admin password.',
      });
    }

    return { ok: true, authenticated: true };
  });
}
