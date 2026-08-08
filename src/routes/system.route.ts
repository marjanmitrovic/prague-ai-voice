import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { getBusinessProfile, listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile } from '../business/business-profile.js';
import { listBookings } from '../business/bookings.js';
import { env } from '../config/env.js';
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
    const storageInfo = getStorageInfo();
    const mailConfigured = emailConfigured();
    const voiceGatewayTokenConfigured = Boolean(env.VOICE_GATEWAY_TOKEN);

    return {
      ok: true,
      version: '3.3.0',
      mode: 'production-polish-no-paid-llm',
      storage: storageInfo.mode,
      databaseUrlConfigured: storageInfo.databaseUrlConfigured,
      telephony: 'voice-gateway-webhook-ready',
      voiceGatewayWebhook: '/api/voice/missed-call',
      voiceGatewayTokenConfigured,
      paidApis: 'disabled',
      emailConfigured: mailConfigured,
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
        emailConfirmation: mailConfigured,
        multiBusiness: true,
        salesLanding: true,
        clientOnboarding: true,
        clientManagement: true,
        knowledgeBase: true,
        weaknessSimulator: true,
        callLeadCapture: true,
        callLeadEmail: mailConfigured,
        voiceGatewayWebhook: true,
        voiceGatewayToken: voiceGatewayTokenConfigured,
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
