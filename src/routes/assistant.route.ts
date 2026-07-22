import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLocalAssistantText } from '../ai/local-business-agent.js';
import { publicBusinessProfile } from '../business/business-profile.js';
import { handleBookingConversation } from '../ai/booking-conversation.js';
import { env } from '../config/env.js';

const assistantTextSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const bookingConversationSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  state: z.unknown().optional(),
});

export async function assistantRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/assistant/status', async () => {
    return {
      ok: true,
      mode: env.AGENT_MODE,
      openaiConfigured: false,
      model: 'local-business-profile-rules-v1',
      paidApiRequired: false,
      profile: publicBusinessProfile(),
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

    const result = createLocalAssistantText(parsed.data.text);
    request.log.info({ intent: result.intent, confidence: result.confidence }, 'Local assistant response created');

    return reply.send({ type: 'assistant_text', ...result });
  });
}
