import { getBusinessProfile, type BusinessProfile, type BusinessService } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

export type LocalAgentResult = {
  text: string;
  model: string;
  intent: string;
  confidence: number;
  matchedSource?: 'rules' | 'faq' | 'service' | 'fallback';
  weakness?: string;
};

export type WeaknessTestResult = LocalAgentResult & {
  question: string;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
};

const MODEL_NAME = 'local-business-profile-rules-no-llm-v2';

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsAny = (text: string, terms: string[]) => terms.some((term) => text.includes(normalize(term)));

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((token) => token.length >= 4));
}

function overlapScore(question: string, candidate: string): number {
  const q = tokenSet(question);
  const c = tokenSet(candidate);
  if (q.size === 0 || c.size === 0) return 0;
  let overlap = 0;
  for (const token of q) if (c.has(token)) overlap += 1;
  return overlap / Math.max(1, Math.min(q.size, c.size));
}

function formatOpeningHours(profile: BusinessProfile): string {
  const parts = profile.openingHours.map((item) => `${item.days} ${item.spoken}`);
  return `Máme otevřeno: ${parts.join(', ')}.`;
}

function formatServices(profile: BusinessProfile): string {
  const serviceNames = profile.services.map((service) => service.name.toLowerCase());
  return `Nabízíme ${serviceNames.join(', ')}.`;
}

function formatAllPrices(profile: BusinessProfile): string {
  const prices = profile.services.map((service) => `${service.name} stojí ${service.spokenPrice}`);
  return `${prices.join('. ')}.`;
}

function serviceAliases(service: BusinessService, profile: BusinessProfile): string[] {
  const configured = profile.vocabulary?.serviceAliases?.[service.name] ?? [];
  return [service.name, service.description, ...configured];
}

function findServiceQuestion(text: string, profile: BusinessProfile) {
  return profile.services.find((service) => {
    const aliases = serviceAliases(service, profile).flatMap((value) => {
      const normalized = normalize(value);
      const words = normalized.split(' ').filter((word) => word.length >= 4);
      return [normalized, ...words];
    });
    return aliases.some((alias) => alias && text.includes(alias));
  });
}

function findFaqAnswer(input: string, profile: BusinessProfile) {
  const faq = profile.knowledgeBase ?? [];
  let best: { score: number; item: (typeof faq)[number] } | null = null;

  for (const item of faq) {
    const keywordHit = (item.keywords ?? []).some((keyword) => normalize(input).includes(normalize(keyword)));
    const score = Math.max(overlapScore(input, item.question), keywordHit ? 0.95 : 0);
    if (!best || score > best.score) best = { score, item };
  }

  if (!best || best.score < 0.38) return null;
  return { ...best.item, score: best.score };
}

export function createLocalAssistantText(input: string, businessSlug = DEFAULT_BUSINESS_SLUG): LocalAgentResult {
  const profile = getBusinessProfile(safeBusinessSlug(businessSlug));
  const text = normalize(input);

  if (!text) {
    return {
      intent: 'empty',
      confidence: 1,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: profile.messages.empty,
    };
  }

  if (containsAny(text, ['ignoruj', 'systemove instrukce', 'api', 'klic', 'prompt', 'tajne', 'pravidla'])) {
    return {
      intent: 'prompt_injection_attempt',
      confidence: 0.85,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: profile.messages.promptInjection,
    };
  }

  const faq = findFaqAnswer(input, profile);
  if (faq) {
    return {
      intent: 'faq_answer',
      confidence: Math.min(0.98, Math.max(0.72, faq.score)),
      model: MODEL_NAME,
      matchedSource: 'faq',
      text: faq.answer,
    };
  }

  if (containsAny(text, ['otevreno', 'oteviraci', 'otviraci', 'kdy mate', 'hodiny', 'pracovni doba', 'doba'])) {
    return {
      intent: 'opening_hours',
      confidence: 0.95,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: formatOpeningHours(profile),
    };
  }

  if (containsAny(text, ['cena', 'kolik', 'stoji', 'korun', 'cenik', 'zaplatim']) || /(^|\s)kc($|\s)/.test(text)) {
    const matchingService = findServiceQuestion(text, profile);
    return {
      intent: matchingService ? 'service_price' : 'price_list',
      confidence: matchingService ? 0.95 : 0.88,
      model: MODEL_NAME,
      matchedSource: matchingService ? 'service' : 'rules',
      text: matchingService
        ? `${matchingService.name} stojí ${matchingService.spokenPrice}. Délka služby je ${matchingService.duration}.`
        : formatAllPrices(profile),
    };
  }

  if (containsAny(text, ['sluzby', 'nabizite', 'nabidka', 'osetreni', 'oboci', 'masaz', 'co delate'])) {
    return {
      intent: 'services',
      confidence: 0.93,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: formatServices(profile),
    };
  }

  const matchingService = findServiceQuestion(text, profile);
  if (matchingService) {
    return {
      intent: 'service_detail',
      confidence: 0.82,
      model: MODEL_NAME,
      matchedSource: 'service',
      text: `${matchingService.name}: ${matchingService.description} Cena je ${matchingService.spokenPrice} a délka služby je ${matchingService.duration}.`,
    };
  }

  if (containsAny(text, ['rezervace', 'termin', 'objednat', 'objednani', 'volny termin', 'zarezervovat', 'rezervovat'])) {
    return {
      intent: 'booking_help',
      confidence: 0.9,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: profile.messages.bookingNotAvailable,
    };
  }

  if (containsAny(text, ['clovek', 'pracovnik', 'operator', 'recepce', 'spojit', 'prepojit'])) {
    return {
      intent: 'human_transfer_not_available_yet',
      confidence: 0.9,
      model: MODEL_NAME,
      matchedSource: 'rules',
      text: profile.messages.humanTransferNotAvailable,
    };
  }

  return {
    intent: 'fallback_with_supported_topics',
    confidence: 0.42,
    model: MODEL_NAME,
    matchedSource: 'fallback',
    weakness: 'missing_knowledge_or_phrase',
    text: profile.messages.fallback,
  };
}

function recommendationFor(result: LocalAgentResult, question: string): string {
  if (result.intent === 'fallback_with_supported_topics') {
    return `Doplnit FAQ odpověď nebo klíčová slova pro dotaz: „${question}“. `;
  }
  if (result.confidence < 0.7) return 'Zkontrolovat formulaci a případně přidat synonymum nebo FAQ.';
  return 'Bez okamžité úpravy.';
}

export function runWeaknessTest(questions: string[], businessSlug = DEFAULT_BUSINESS_SLUG): WeaknessTestResult[] {
  return questions.map((question) => {
    const result = createLocalAssistantText(question, businessSlug);
    const risk: WeaknessTestResult['risk'] = result.intent === 'fallback_with_supported_topics' ? 'high' : result.confidence < 0.72 ? 'medium' : 'low';
    return { question, ...result, risk, recommendation: recommendationFor(result, question) };
  });
}
