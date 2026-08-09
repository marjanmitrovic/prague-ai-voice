import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { getBusinessProfile, listPublicBusinesses, publicBusinessProfile, reloadBusinessProfile } from '../business/business-profile.js';
import { listBookings } from '../business/bookings.js';
import { env } from '../config/env.js';
import { callLeadEmailConfigured } from '../email/call-lead-email.js';
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
    const smtpConfigured = emailConfigured();
    const callLeadMailConfigured = callLeadEmailConfigured();
    const voiceGatewayTokenConfigured = Boolean(env.VOICE_GATEWAY_TOKEN);
    const adminPasswordConfigured = Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8);

    return {
      ok: true,
      version: '3.9.0',
      mode: 'client-onboarding-pack-admin-protected-no-paid-llm',
      storage: storageInfo.mode,
      databaseUrlConfigured: storageInfo.databaseUrlConfigured,
      telephony: 'voice-gateway-webhook-ready',
      voiceGatewayWebhook: '/api/voice/missed-call',
      voiceWebhookTestPage: '/voice-webhook-test',
      voiceGatewayTokenConfigured,
      voiceGatewayTokenRequired: voiceGatewayTokenConfigured,
      paidApis: 'disabled',
      emailProvider: env.EMAIL_PROVIDER,
      brevoApiConfigured: Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL && env.BUSINESS_OWNER_EMAIL),
      smtpConfigured,
      emailConfigured: callLeadMailConfigured,
      adminPasswordConfigured,
      adminStaticPagesProtected: adminPasswordConfigured,
      adminLogoutEndpoint: '/api/admin/logout',
      adminDashboard: '/admin',
      adminDashboardReady: true,
      clientOnboardingPack: '/client-onboarding-pack',
      clientOnboardingPackReady: true,
      publicNavigationCleaned: true,
      publicPages: ['/', '/sales', '/booking', '/demo-scenarios', '/sales-presentation', '/phone-connection'],
      protectedPages: ['/admin', '/client-onboarding-pack', '/call-leads', '/production-checklist', '/voice-webhook-test', '/unknown-questions', '/website-import', '/weaknesses', '/clients', '/onboarding', '/tts-test'],
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
        adminLogin: adminPasswordConfigured,
        adminLogout: true,
        adminDashboard: true,
        clientOnboardingPack: true,
        adminStaticPagesProtected: adminPasswordConfigured,
        publicNavigationCleaned: true,
        emailConfirmation: callLeadMailConfigured,
        multiBusiness: true,
        salesLanding: true,
        clientOnboarding: true,
        clientManagement: true,
        knowledgeBase: true,
        weaknessSimulator: true,
        callLeadCapture: true,
        callLeadEmail: callLeadMailConfigured,
        emailApi: Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL && env.BUSINESS_OWNER_EMAIL),
        smtp: smtpConfigured,
        voiceGatewayWebhook: true,
        voiceGatewayToken: voiceGatewayTokenConfigured,
        voiceGatewayTokenRequired: voiceGatewayTokenConfigured,
        voiceWebhookTestPage: true,
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
