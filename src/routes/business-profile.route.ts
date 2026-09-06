import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { recordClientActivity } from '../client-activity-log.js';
import { getBusinessProfile, listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile, saveBusinessProfile } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, SECONDARY_DEMO_SLUG, deleteBusinessProfileData, safeBusinessSlug } from '../storage-postgres.js';

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

function findBusinessSummary(businessSlug: string) {
  return listPublicBusinesses().find((business) => business.slug === businessSlug);
}

function profileFromRestoreBody(body: unknown): Record<string, unknown> {
  const input = body as Record<string, unknown> | undefined;
  if (!input) throw new Error('Backup data chybí.');
  const nestedProfile = input.profile as Record<string, unknown> | undefined;
  const profile = nestedProfile && typeof nestedProfile === 'object' ? nestedProfile : input;
  if (!profile.businessSlug || !profile.companyName || !profile.services) {
    throw new Error('Soubor nevypadá jako platný backup business profilu.');
  }
  return profile;
}

function protectedDemoSlug(slug: string): boolean {
  return slug === DEFAULT_BUSINESS_SLUG || slug === SECONDARY_DEMO_SLUG;
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
      recordClientActivity({
        action: 'client_created',
        businessSlug,
        companyName: profile.companyName,
        message: `Klient ${profile.companyName} byl vytvořen.`,
        details: { services: profile.services.length },
      });
      request.log.info({ businessSlug, companyName: profile.companyName, services: profile.services.length }, 'Business profile created');
      return reply.code(201).send({ ok: true, profile: publicBusinessProfile(profile) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile create failed';
      return reply.code(400).send({ ok: false, error: 'invalid_business_profile', message });
    }
  });

  app.post('/api/business-profile/restore', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const body = request.body as Record<string, unknown>;
      const restoredProfile = profileFromRestoreBody(body);
      const bodySlug = safeBusinessSlug(String(restoredProfile.businessSlug));
      const targetSlug = safeBusinessSlug(String(body.businessSlug || queryBusinessSlug(request.query) || bodySlug));

      if (targetSlug !== bodySlug) {
        return reply.code(400).send({
          ok: false,
          error: 'restore_slug_mismatch',
          message: 'Backup patří jinému klientovi. Vyberte správný slug nebo použijte odpovídající backup.',
          backupSlug: bodySlug,
          targetSlug,
        });
      }

      const existing = findBusinessSummary(targetSlug);
      if (!existing) {
        return reply.code(404).send({
          ok: false,
          error: 'business_profile_not_found',
          message: 'Klient pro obnovu nebyl nalezen. Obnova je povolena pouze pro existující klienty.',
          businessSlug: targetSlug,
        });
      }

      const profile = await saveBusinessProfile({ ...restoredProfile, businessSlug: targetSlug }, targetSlug);
      recordClientActivity({
        action: 'client_restored',
        businessSlug: targetSlug,
        companyName: profile.companyName,
        message: `Klient ${profile.companyName} byl obnoven z backupu.`,
        details: { services: profile.services.length },
      });
      request.log.warn({ businessSlug: targetSlug, companyName: profile.companyName, services: profile.services.length }, 'Business profile restored from backup');
      return { ok: true, restored: true, profile: publicBusinessProfile(profile) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile restore failed';
      return reply.code(400).send({ ok: false, error: 'invalid_business_profile_backup', message });
    }
  });

  app.delete('/api/business-profile', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const body = request.body as Record<string, unknown> | undefined;
      const businessSlug = safeBusinessSlug(String(body?.businessSlug || queryBusinessSlug(request.query)));
      const confirmation = String(body?.confirmation || '').trim();
      const existing = findBusinessSummary(businessSlug);

      if (!existing) {
        return reply.code(404).send({ ok: false, error: 'business_profile_not_found', message: 'Klient nebyl nalezen.', businessSlug });
      }

      if (protectedDemoSlug(businessSlug)) {
        return reply.code(403).send({
          ok: false,
          error: 'protected_business_slug',
          message: 'Tento demo profil je chráněný a nelze ho smazat přes editor.',
          businessSlug,
        });
      }

      if (confirmation !== businessSlug) {
        return reply.code(400).send({
          ok: false,
          error: 'delete_confirmation_required',
          message: 'Pro smazání napište přesný slug klienta.',
          businessSlug,
        });
      }

      await deleteBusinessProfileData(businessSlug);
      recordClientActivity({
        action: 'client_deleted',
        businessSlug,
        companyName: existing.companyName,
        message: `Klient ${existing.companyName} byl smazán.`,
        details: { services: existing.servicesCount },
      });
      request.log.warn({ businessSlug, companyName: existing.companyName }, 'Business profile deleted');
      return { ok: true, deleted: true, businessSlug, business: existing };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile delete failed';
      return reply.code(400).send({ ok: false, error: 'business_profile_delete_failed', message });
    }
  });

  app.put('/api/business-profile', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const body = request.body as Record<string, unknown>;
      const businessSlug = safeBusinessSlug(String(body.businessSlug || queryBusinessSlug(request.query)));
      const profile = await saveBusinessProfile({ ...body, businessSlug }, businessSlug);
      recordClientActivity({
        action: 'client_updated',
        businessSlug,
        companyName: profile.companyName,
        message: `Profil klienta ${profile.companyName} byl upraven.`,
        details: { services: profile.services.length },
      });
      request.log.info({ businessSlug, companyName: profile.companyName, services: profile.services.length }, 'Business profile saved');
      return { ok: true, profile: publicBusinessProfile(profile) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile save failed';
      return reply.code(400).send({ ok: false, error: 'invalid_business_profile', message });
    }
  });
}
