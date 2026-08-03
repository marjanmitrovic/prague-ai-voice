import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { getKnowledgeBase, saveKnowledgeBase } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

const faqItemSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});

const faqSaveSchema = z.object({
  businessSlug: z.string().optional(),
  knowledgeBase: z.array(faqItemSchema).max(200),
});

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

export async function knowledgeRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/knowledge/faq', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = queryBusinessSlug(request.query);
    return { ok: true, businessSlug, knowledgeBase: getKnowledgeBase(businessSlug) };
  });

  app.put('/api/knowledge/faq', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = faqSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_knowledge_base', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const knowledgeBase = await saveKnowledgeBase(parsed.data.knowledgeBase, businessSlug);
    return { ok: true, businessSlug, knowledgeBase };
  });
}
