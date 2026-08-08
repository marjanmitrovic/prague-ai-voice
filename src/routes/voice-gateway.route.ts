import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createCallLead } from './call-leads.route.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

const missedCallWebhookSchema = z.object({
  businessSlug: z.string().optional(),
  customerPhone: z.string().trim().min(3).max(80),
  customerName: z.string().trim().max(160).optional().default('Neznámý zákazník'),
  serviceName: z.string().trim().max(160).optional().default('Telefonický dotaz'),
  message: z.string().trim().min(1).max(3000),
  transcript: z.string().trim().max(3000).optional(),
  source: z.string().trim().min(1).max(80).optional().default('voice_gateway'),
});

function tokenFromRequest(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization || '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  const headerToken = request.headers['x-voice-gateway-token'];
  if (Array.isArray(headerToken)) return headerToken.at(0) || null;
  return headerToken || null;
}

function isGatewayAuthorized(request: FastifyRequest): boolean {
  if (!env.VOICE_GATEWAY_TOKEN) return true;
  return tokenFromRequest(request) === env.VOICE_GATEWAY_TOKEN;
}

export async function voiceGatewayRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/voice/missed-call', async (request, reply) => {
    if (!isGatewayAuthorized(request)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Neplatný voice gateway token.' });
    }

    const parsed = missedCallWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const result = await createCallLead({
      businessSlug,
      customerName: parsed.data.customerName || 'Neznámý zákazník',
      customerPhone: parsed.data.customerPhone,
      serviceName: parsed.data.serviceName || 'Telefonický dotaz',
      message: parsed.data.transcript || parsed.data.message,
      status: 'nové',
      source: parsed.data.source || 'voice_gateway',
    });

    return reply.code(201).send({
      ok: true,
      source: 'voice_gateway',
      businessSlug,
      storage: result.storage,
      lead: result.lead,
      notification: result.notification,
      nextAction: 'owner_callback',
    });
  });
}
