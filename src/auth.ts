import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './config/env.js';

const ADMIN_COOKIE_NAME = 'pav_admin_session';

export function adminPasswordConfigured(): boolean {
  return Boolean(env.ADMIN_PASSWORD || env.NODE_ENV !== 'production');
}

export function expectedAdminPassword(): string | undefined {
  return env.ADMIN_PASSWORD || (env.NODE_ENV === 'production' ? undefined : 'admin');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : header || '';
  return raw.split(';').reduce<Record<string, string>>((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function signAdminSession(exp: number, password: string): string {
  return createHmac('sha256', password)
    .update(String(exp))
    .digest('base64url');
}

function hasAdminCookieSession(request: FastifyRequest): boolean {
  const expected = expectedAdminPassword();
  if (!expected) return false;
  const token = parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME];
  if (!token) return false;
  const [expRaw, signature] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !signature) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, signAdminSession(exp, expected));
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
  const provided = readAdminPassword(request);
  if (provided === expected) return true;
  return hasAdminCookieSession(request);
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
