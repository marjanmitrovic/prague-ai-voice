import type { FastifyInstance } from 'fastify';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'prague-ai-voice',
    version: '1.9.0',
    mode: 'czech-ui-neon-demo',
    features: [
      'local-business-profile',
      'local-bookings',
      'availability-rules',
      'conversational-booking',
      'czech-neural-tts',
      'postgres-storage',
      'email-confirmation',
    ],
  }));
}
