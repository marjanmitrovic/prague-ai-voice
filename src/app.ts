import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { logger } from './logging/logger.js';
import { healthRoute } from './routes/health.route.js';
import { staticRoute } from './routes/static.route.js';
import { assistantRoute } from './routes/assistant.route.js';
import { ttsRoute } from './routes/tts.route.js';
import { bookingsRoute } from './routes/bookings.route.js';
import { businessProfileRoute } from './routes/business-profile.route.js';
import { systemRoute } from './routes/system.route.js';
import { adminRoute } from './routes/admin.route.js';
import { knowledgeRoute } from './routes/knowledge.route.js';
import { websiteImportRoute } from './routes/website-import.route.js';
import { callLeadsRoute } from './routes/call-leads.route.js';
import { voiceGatewayRoute } from './routes/voice-gateway.route.js';
import { clientProfileBuilderRoute } from './routes/client-profile-builder.route.js';
import { browserVoiceRoute } from './websocket/browser-voice.route.js';
import { initializeStorage } from './storage-postgres.js';

export async function buildApp() {
  await initializeStorage();

  const app = Fastify({ loggerInstance: logger });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 * 4 } });

  await app.register(healthRoute);
  await app.register(staticRoute);
  await app.register(assistantRoute);
  await app.register(ttsRoute);
  await app.register(bookingsRoute);
  await app.register(businessProfileRoute);
  await app.register(systemRoute);
  await app.register(adminRoute);
  await app.register(knowledgeRoute);
  await app.register(websiteImportRoute);
  await app.register(callLeadsRoute);
  await app.register(voiceGatewayRoute);
  await app.register(clientProfileBuilderRoute);
  await app.register(browserVoiceRoute);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
