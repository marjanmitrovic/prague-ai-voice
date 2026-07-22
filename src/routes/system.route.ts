import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { getBusinessProfile, listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile } from '../business/business-profile.js';
import { listBookings } from '../business/bookings.js';
import { DEFAULT_BUSINESS_SLUG, getStorageInfo, resetDemoDataFromJsonSeed, safeBusinessSlug } from '../storage-postgres.js';
import { emailConfigured } from '../email.js';

function countFiles(path: string): number {
  if (!existsSync(path)) return 0;
  return readdirSync(path).filter((name) => {
    const full = resolve(path, name);
    return statSync(full).isFile();
  }).length;
}

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

export async function systemRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/system/status', async (request) => {
    const businessSlug = queryBusinessSlug(request.query);
    const profile = getBusinessProfile(businessSlug);
    const bookings = listBookings(businessSlug);
    const businesses = listPublicBusinesses();
    return {
      ok: true,
      version: '1.9.0',
      mode: 'czech-client-management-multi-business-demo',
      storage: getStorageInfo().mode,
      databaseUrlConfigured: getStorageInfo().databaseUrlConfigured,
      telephony: 'disabled',
      paidApis: 'disabled',
      emailConfigured: emailConfigured(),
      businessSlug,
      businessesCount: businesses.length,
      businesses,
      companyName: profile.companyName,
      servicesCount: profile.services.length,
      bookingsCount: bookings.length,
      activeBookingsCount: bookings.filter((booking) => booking.status === 'requested').length,
      logsCount: countFiles(resolve(process.cwd(), 'logs')),
      checks: {
        businessProfile: true,
        bookings: true,
        availability: true,
        conversationalBooking: true,
        czechTts: true,
        adminLogin: true,
        emailConfirmation: emailConfigured(),
        multiBusiness: true,
        salesLanding: true,
        clientOnboarding: true,
        clientManagement: true,
      },
    };
  });

  app.get('/api/system/backup.json', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = queryBusinessSlug(request.query);
    const profile = getBusinessProfile(businessSlug);
    const bookings = listBookings(businessSlug);
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="prague-ai-voice-${businessSlug}-backup.json"`)
      .send({ ok: true, exportedAt: new Date().toISOString(), businessSlug, profile, bookings });
  });

  app.post('/api/system/demo-reset', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    try {
      const businessSlug = queryBusinessSlug(request.query);
      await resetDemoDataFromJsonSeed(businessSlug);
      const profile = reloadBusinessProfile(businessSlug);
      return { ok: true, profile: publicBusinessProfile(profile), bookingsCount: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Demo reset failed';
      return reply.code(400).send({ ok: false, error: 'demo_reset_failed', message });
    }
  });
}
