import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.x-twilio-signature',
      'TWILIO_AUTH_TOKEN',
      '*.TWILIO_AUTH_TOKEN',
    ],
    censor: '[REDACTED]',
  },
});
