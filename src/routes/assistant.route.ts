import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLocalAssistantText, runWeaknessTest } from '../ai/local-business-agent.js';
import { publicBusinessProfile } from '../business/business-profile.js';
import { handleBookingConversation } from '../ai/booking-conversation.js';
import { env } from '../config/env.js';
import { requireAdmin } from '../auth.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

const assistantTextSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  businessSlug: z.string().optional(),
});

const bookingConversationSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  state: z.unknown().optional(),
});

const testSuiteSchema = z.object({
  businessSlug: z.string().optional(),
  questions: z.array(z.string().trim().min(1).max(400)).min(1).max(80),
});

export async function assistantRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/assistant/status', async (request) => {
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    return {
      ok: true,
      mode: env.AGENT_MODE,
      openaiConfigured: false,
      model: 'local-business-profile-rules-no-llm-v2',
      paidApiRequired: false,
      profile: publicBusinessProfile(undefined, businessSlug),
    };
  });

  app.post('/api/assistant/booking-conversation', async (request, reply) => {
    const parsed = bookingConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const result = await handleBookingConversation(parsed.data.text, parsed.data.state);
    request.log.info({ intent: result.intent, stage: result.state.stage }, 'Booking conversation response created');
    return reply.send({ ok: true, type: 'booking_conversation', ...result });
  });

  app.post('/api/assistant/text', async (request, reply) => {
    const parsed = assistantTextSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const result = createLocalAssistantText(parsed.data.text, businessSlug);
    request.log.info({ businessSlug, intent: result.intent, confidence: result.confidence }, 'Local assistant response created');

    return reply.send({ ok: true, type: 'assistant_text', businessSlug, ...result });
  });

  app.post('/api/assistant/test-suite', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = testSuiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const results = runWeaknessTest(parsed.data.questions, businessSlug);
    const highRisk = results.filter((item) => item.risk === 'high').length;
    const mediumRisk = results.filter((item) => item.risk === 'medium').length;
    return reply.send({
      ok: true,
      businessSlug,
      total: results.length,
      highRisk,
      mediumRisk,
      lowRisk: results.length - highRisk - mediumRisk,
      results,
    });
  });
}
