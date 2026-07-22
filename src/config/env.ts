import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  POC_MAX_SESSION_SECONDS: z.coerce.number().int().min(30).max(900).default(480),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AGENT_MODE: z.enum(['local']).default('local'),
  EDGE_TTS_PYTHON: optionalString,
  DATABASE_URL: optionalUrl,
  ADMIN_PASSWORD: z.string().min(8).optional(),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: optionalString,
  BUSINESS_OWNER_EMAIL: optionalEmail,
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
