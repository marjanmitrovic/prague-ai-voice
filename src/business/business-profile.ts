import { z } from 'zod';
import { DEFAULT_BUSINESS_SLUG, listBusinessSummaries, readProfileJson, safeBusinessSlug, writeProfileJson } from '../storage-postgres.js';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const dayKeySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

const openingHoursSchema = z.object({
  days: z.string().min(1),
  hours: z.string().min(1),
  spoken: z.string().min(1),
});

const workingIntervalSchema = z.object({
  start: timeSchema,
  end: timeSchema,
});

const bookingRulesSchema = z.object({
  timezone: z.string().min(1).default('Europe/Prague'),
  slotMinutes: z.number().int().min(5).max(120).default(15),
  minNoticeMinutes: z.number().int().min(0).max(10080).default(60),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  workingHours: z.record(dayKeySchema, z.array(workingIntervalSchema)).default({
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  }),
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});

const knowledgeFaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
});

const unknownQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1).optional().default(''),
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
  createdAt: z.string().min(1),
  count: z.number().int().min(1).default(1),
});

const vocabularySchema = z.object({
  serviceAliases: z.record(z.string(), z.array(z.string())).default({}),
  generalKeywords: z.array(z.string()).default([]),
}).default({ serviceAliases: {}, generalKeywords: [] });

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.string().min(1),
  spokenPrice: z.string().min(1),
  duration: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  bookingEnabled: z.boolean().default(true),
});

const businessProfileSchema = z.object({
  businessSlug: z.string().regex(/^[a-z0-9-]+$/).optional().default(DEFAULT_BUSINESS_SLUG),
  companyName: z.string().min(1),
  assistantName: z.string().min(1),
  language: z.string().min(2),
  currency: z.string().min(1),
  description: z.string().min(1),
  address: z.string().min(1),
  openingHours: z.array(openingHoursSchema).min(1),
  bookingRules: bookingRulesSchema,
  services: z.array(serviceSchema).min(1),
  messages: z.object({
    empty: z.string().min(1),
    bookingNotAvailable: z.string().min(1),
    humanTransferNotAvailable: z.string().min(1),
    promptInjection: z.string().min(1),
    fallback: z.string().min(1),
  }),
  knowledgeBase: z.array(knowledgeFaqSchema).default([]),
  vocabulary: vocabularySchema,
  unknownQuestions: z.array(unknownQuestionSchema).default([]),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type BusinessService = BusinessProfile['services'][number];
export type DayKey = z.infer<typeof dayKeySchema>;
export type UnknownQuestion = BusinessProfile['unknownQuestions'][number];

const profileCache = new Map<string, BusinessProfile>();

function unknownQuestionId(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `unknown-${Date.now()}`;
}

export function loadBusinessProfile(businessSlug = DEFAULT_BUSINESS_SLUG): BusinessProfile {
  const slug = safeBusinessSlug(businessSlug);
  const raw = readProfileJson(slug);
  const parsed = businessProfileSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) {
    throw new Error(`Invalid business profile: ${parsed.error.message}`);
  }

  const normalized = { ...parsed.data, businessSlug: slug };
  profileCache.set(slug, normalized);
  return normalized;
}

export function getBusinessProfile(businessSlug = DEFAULT_BUSINESS_SLUG): BusinessProfile {
  const slug = safeBusinessSlug(businessSlug);
  if (!profileCache.has(slug)) profileCache.set(slug, loadBusinessProfile(slug));
  const profile = profileCache.get(slug);
  if (!profile) throw new Error('Business profile not loaded');
  return profile;
}

export function reloadBusinessProfile(businessSlug = DEFAULT_BUSINESS_SLUG): BusinessProfile {
  const slug = safeBusinessSlug(businessSlug);
  const profile = loadBusinessProfile(slug);
  profileCache.set(slug, profile);
  return profile;
}

export async function saveBusinessProfile(input: unknown, businessSlug = DEFAULT_BUSINESS_SLUG): Promise<BusinessProfile> {
  const parsed = businessProfileSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(`Invalid business profile: ${parsed.error.message}`);
  }

  const slug = safeBusinessSlug((parsed.data as { businessSlug?: string }).businessSlug || businessSlug);
  const normalized = { ...parsed.data, businessSlug: slug };
  await writeProfileJson(`${JSON.stringify(normalized, null, 2)}\n`, slug);
  profileCache.set(slug, normalized);
  return normalized;
}

export function publicBusinessProfile(profile?: BusinessProfile, businessSlug = DEFAULT_BUSINESS_SLUG) {
  const selected = profile ?? getBusinessProfile(businessSlug);
  return {
    businessSlug: selected.businessSlug,
    companyName: selected.companyName,
    assistantName: selected.assistantName,
    language: selected.language,
    description: selected.description,
    address: selected.address,
    openingHours: selected.openingHours,
    bookingRules: selected.bookingRules,
    services: selected.services.map((service) => ({
      name: service.name,
      description: service.description,
      price: service.price,
      duration: service.duration,
      durationMinutes: service.durationMinutes,
      bookingEnabled: service.bookingEnabled,
    })),
  };
}

export function listPublicBusinesses() {
  return listBusinessSummaries();
}

export function getKnowledgeBase(businessSlug = DEFAULT_BUSINESS_SLUG) {
  return getBusinessProfile(businessSlug).knowledgeBase;
}

export async function saveKnowledgeBase(input: unknown, businessSlug = DEFAULT_BUSINESS_SLUG) {
  const parsed = z.array(knowledgeFaqSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid knowledge base: ${parsed.error.message}`);
  }

  const profile = getBusinessProfile(businessSlug);
  const saved = await saveBusinessProfile({ ...profile, knowledgeBase: parsed.data }, businessSlug);
  return saved.knowledgeBase;
}

export function getUnknownQuestions(businessSlug = DEFAULT_BUSINESS_SLUG) {
  return getBusinessProfile(businessSlug).unknownQuestions
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recordUnknownQuestion(input: {
  businessSlug?: string;
  question: string;
  answer?: string;
  intent: string;
  confidence: number;
  recommendation?: string;
}) {
  const slug = safeBusinessSlug(input.businessSlug || DEFAULT_BUSINESS_SLUG);
  const question = input.question.trim();
  if (!question) return getUnknownQuestions(slug);

  const profile = getBusinessProfile(slug);
  const id = unknownQuestionId(question);
  const existing = profile.unknownQuestions.find((item) => item.id === id);
  const now = new Date().toISOString();
  const nextUnknownQuestions = existing
    ? profile.unknownQuestions.map((item) => item.id === id
        ? { ...item, count: item.count + 1, createdAt: now, answer: input.answer || item.answer, intent: input.intent, confidence: input.confidence }
        : item)
    : [
        {
          id,
          question,
          answer: input.answer || '',
          intent: input.intent,
          confidence: input.confidence,
          recommendation: input.recommendation || 'Doplnit odpověď do FAQ nebo přidat synonymum.',
          createdAt: now,
          count: 1,
        },
        ...profile.unknownQuestions,
      ];

  const trimmed = nextUnknownQuestions.slice(0, 100);
  const saved = await saveBusinessProfile({ ...profile, unknownQuestions: trimmed }, slug);
  return saved.unknownQuestions;
}

export async function clearUnknownQuestions(businessSlug = DEFAULT_BUSINESS_SLUG) {
  const slug = safeBusinessSlug(businessSlug);
  const profile = getBusinessProfile(slug);
  const saved = await saveBusinessProfile({ ...profile, unknownQuestions: [] }, slug);
  return saved.unknownQuestions;
}
