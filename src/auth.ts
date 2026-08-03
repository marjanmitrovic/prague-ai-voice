import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './config/env.js';

export function adminPasswordConfigured(): boolean {
  return Boolean(env.ADMIN_PASSWORD || env.NODE_ENV !== 'production');
}

export function expectedAdminPassword(): string | undefined {
  return env.ADMIN_PASSWORD || (env.NODE_ENV === 'production' ? undefined : 'admin');
}

function readAdminPassword(request: FastifyRequest): string | undefined {
  const headerPassword = request.headers['x-admin-password'];
  if (typeof headerPassword === 'string' && headerPassword.trim()) return headerPassword.trim();

  const authorization = request.headers.authorization;
  if (!authorization) return undefined;

  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  if (authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
      const password = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
      return password.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function isAdminRequest(request: FastifyRequest): boolean {
  const expected = expectedAdminPassword();
  if (!expected) return false;
  return readAdminPassword(request) === expected;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!adminPasswordConfigured()) {
    await reply.code(503).send({
      ok: false,
      error: 'admin_password_not_configured',
      message: 'ADMIN_PASSWORD is not configured on the server.',
    });
    return false;
  }

  if (!isAdminRequest(request)) {
    await reply.code(401).send({
      ok: false,
      error: 'admin_auth_required',
      message: 'Admin password is required.',
    });
    return false;
  }

  return true;
}
