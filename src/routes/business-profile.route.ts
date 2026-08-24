import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { getBusinessProfile, listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile, saveBusinessProfile } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

function findBusinessSummary(businessSlug: string) {
  return listPublicBusinesses().find((business) => business.slug === businessSlug);
}

export async function businessProfileRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/businesses', async () => {
    return { ok: true, businesses: listPublicBusinesses() };
  });

  app.get('/api/business-profile/exists', async (request) => {
    const businessSlug = queryBusinessSlug(request.query);
    const existing = findBusinessSummary(businessSlug);
    return {
      ok: true,
      businessSlug,
      exists: Boolean(existing),
      business: existing ?? null,
    };
  });

  app.get('/api/business-profile/full', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const businessSlug = queryBusinessSlug(request.query);
      const profile = getBusinessProfile(businessSlug);
      return { ok: true, profile };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile load failed';
      return reply.code(404).send({ ok: false, error: 'business_profile_not_found', message });
    }
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

  app.post('/api/business-profile/create', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const body = request.body as Record<string, unknown>;
      const businessSlug = safeBusinessSlug(String(body.businessSlug || queryBusinessSlug(request.query)));
      const existing = findBusinessSummary(businessSlug);
      if (existing) {
        return reply.code(409).send({
          ok: false,
          error: 'business_slug_exists',
          message: 'Tento slug už existuje. Zvolte jiný název nebo jiný slug.',
          businessSlug,
          business: existing,
        });
      }

      const profile = await saveBusinessProfile({ ...body, businessSlug }, businessSlug);
      request.log.info({ businessSlug, companyName: profile.companyName, services: profile.services.length }, 'Business profile created');
      return reply.code(201).send({ ok: true, profile: publicBusinessProfile(profile) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile create failed';
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
