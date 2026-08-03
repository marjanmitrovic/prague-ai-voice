import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile, saveBusinessProfile } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

export async function businessProfileRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/businesses', async () => {
    return { ok: true, businesses: listPublicBusinesses() };
  });

  app.get('/api/business-profile', async (request) => {
    const businessSlug = queryBusinessSlug(request.query);
    return { ok: true, profile: publicBusinessProfile(undefined, businessSlug) };
  });

  app.post('/api/business-profile/reload', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const businessSlug = queryBusinessSlug(request.query);
      const profile = reloadBusinessProfile(businessSlug);
      return { ok: true, profile: publicBusinessProfile(profile) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile reload failed';
      return reply.code(400).send({ ok: false, error: 'invalid_business_profile', message });
    }
  });

  app.put('/api/business-profile', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const body = request.body as Record<string, unknown>;
      const businessSlug = safeBusinessSlug(String(body.businessSlug || queryBusinessSlug(request.query)));
      const profile = await saveBusinessProfile({ ...body, businessSlug }, businessSlug);
      request.log.info({ businessSlug, companyName: profile.companyName, services: profile.services.length }, 'Business profile saved');
      return { ok: true, profile: publicBusinessProfile(profile) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile save failed';
      return reply.code(400).send({ ok: false, error: 'invalid_business_profile', message });
    }
  });
}
