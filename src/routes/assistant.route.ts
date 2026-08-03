import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLocalAssistantText, runWeaknessTest } from '../ai/local-business-agent.js';
import {
  clearUnknownQuestions,
  getUnknownQuestions,
  promoteUnknownQuestionToFaq,
  publicBusinessProfile,
  recordUnknownQuestion,
} from '../business/business-profile.js';
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

const promoteUnknownQuestionSchema = z.object({
  businessSlug: z.string().optional(),
  id: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
});

function splitQuestions(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const pieces = text.split(/(?<=[?？])\s+/).map((item) => item.trim()).filter(Boolean);
  return pieces.length > 1 ? pieces : [text.trim()];
}

function shouldRecordUnknown(result: { intent: string; confidence: number }) {
  return result.intent === 'fallback_with_supported_topics' || result.confidence < 0.7;
}

export async function assistantRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/assistant/status', async (request) => {
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    return {
      ok: true,
      mode: env.AGENT_MODE,
      openaiConfigured: false,
      model: 'local-business-profile-rules-no-llm-v4-unknown-report',
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
    const questions = splitQuestions(parsed.data.text);
    const results = [];

    for (const question of questions) {
      const result = createLocalAssistantText(question, businessSlug);
      if (shouldRecordUnknown(result)) {
        await recordUnknownQuestion({
          businessSlug,
          question,
          answer: result.text,
          intent: result.intent,
          confidence: result.confidence,
          recommendation: 'Doplnit odpověď do FAQ nebo přidat synonymum pro tento dotaz.',
        });
      }
      results.push({ question, ...result });
    }

    const primary = results.at(0);
    if (!primary) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Nebyla zadána žádná otázka.' });
    }

    const text = results.length === 1
      ? primary.text
      : results.map((item, index) => `${index + 1}. ${item.question}\n${item.text}`).join('\n\n');

    request.log.info({ businessSlug, questions: results.length, intent: primary.intent, confidence: primary.confidence }, 'Local assistant response created');

    return reply.send({
      ok: true,
      type: 'assistant_text',
      businessSlug,
      ...primary,
      text,
      multiQuestion: results.length > 1,
      results,
    });
  });

  app.get('/api/assistant/unknown-questions', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    const unknownQuestions = getUnknownQuestions(businessSlug);
    return { ok: true, businessSlug, total: unknownQuestions.length, unknownQuestions };
  });

  app.post('/api/assistant/unknown-questions/promote', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = promoteUnknownQuestionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const result = await promoteUnknownQuestionToFaq({
      businessSlug,
      id: parsed.data.id,
      answer: parsed.data.answer,
      keywords: parsed.data.keywords,
    });

    return reply.send({
      ok: true,
      businessSlug,
      faqItem: result.faqItem,
      totalUnknownQuestions: result.unknownQuestions.length,
      unknownQuestions: result.unknownQuestions,
    });
  });

  app.delete('/api/assistant/unknown-questions', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    const unknownQuestions = await clearUnknownQuestions(businessSlug);
    return { ok: true, businessSlug, total: unknownQuestions.length, unknownQuestions };
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
