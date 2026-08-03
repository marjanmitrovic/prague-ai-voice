import { getBusinessProfile, type BusinessProfile, type BusinessService } from '../business/business-profile.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

export type LocalAgentResult = {
  text: string;
  model: string;
  intent: string;
  confidence: number;
  matchedSource?: 'rules' | 'faq' | 'service' | 'fallback' | 'synonyms';
  weakness?: string;
};

export type WeaknessTestResult = LocalAgentResult & {
  question: string;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
};

const MODEL_NAME = 'local-business-profile-rules-no-llm-v4-multi-question';

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PHRASES = {
  openingHours: [
    'otevreno', 'oteviraci', 'otviraci', 'oteviracka', 'kdy mate', 'kdy je otevreno', 'hodiny',
    'pracovni doba', 'provozni doba', 'doba', 'v kolik', 'do kolika', 'od kolika', 'mate dnes otevreno',
    'jste dnes otevreni', 'kdy zavirate', 'kdy otvirate', 'vikend', 'sobota', 'nedele'
  ],
  price: [
    'cena', 'ceny', 'cenik', 'kolik', 'kolik stoji', 'stoji', 'za kolik', 'korun', 'kc', 'czk',
    'platba', 'zaplatim', 'cena za', 'kolik me to bude stat', 'jak drahe', 'drahe', 'levne',
    'tarif', 'poplatek', 'castka'
  ],
  services: [
    'sluzby', 'sluzba', 'nabizite', 'nabidka', 'co delate', 'co umite', 'co poskytujete',
    'osetreni', 'zakroky', 'procedury', 'moznosti', 'mate v nabidce', 'seznam sluzeb'
  ],
  booking: [
    'rezervace', 'rezervovat', 'zarezervovat', 'objednat', 'objednani', 'termin', 'volny termin',
    'volno', 'mate volno', 'chci prijit', 'muzu prijit', 'objednavka', 'schuzka', 'slot', 'cas',
    'dnes', 'zitra', 'pozitri', 'pristi tyden'
  ],
  human: [
    'clovek', 'pracovnik', 'operator', 'recepce', 'spojit', 'prepojit', 'zivy asistent', 'zamestnanec',
    'majitel', 'mluvit s nekym', 'kontaktovat cloveka'
  ],
  address: [
    'adresa', 'kde jste', 'kde vas najdu', 'kde sidlite', 'kam mam prijit', 'lokace', 'pobocka',
    'misto', 'mapa', 'jak se k vam dostanu', 'kde to je'
  ],
  duration: [
    'jak dlouho', 'doba trvani', 'trva', 'kolik minut', 'na jak dlouho', 'delka', 'delka sluzby',
    'casove', 'jak dlouhe'
  ],
  greeting: [
    'dobry den', 'ahoj', 'zdravim', 'dobry vecer', 'nazdar', 'hello', 'hi'
  ]
} as const;

type PhraseIntent = keyof typeof PHRASES;

const containsAny = (text: string, terms: readonly string[]) => terms.some((term) => text.includes(normalize(term)));

function splitCustomerQuestions(input: string): string[] {
  return input
    .split(/\r?\n|(?<=[?!.])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽa-záčďéěíňóřšťúůýž])/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 12);
}

function detectIntent(text: string): PhraseIntent | null {
  const priority: PhraseIntent[] = ['price', 'openingHours', 'booking', 'duration', 'address', 'services', 'human', 'greeting'];
  return priority.find((intent) => containsAny(text, PHRASES[intent])) ?? null;
}

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
  const generated = [
    service.name,
    service.description,
    ...service.name.split(/\s+/),
    ...service.description.split(/\s+/),
  ];
  return [...generated, ...configured].filter((item) => normalize(item).length >= 3);
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

function answerByDetectedIntent(intent: PhraseIntent, text: string, profile: BusinessProfile): LocalAgentResult | null {
  const matchingService = findServiceQuestion(text, profile);

  if (intent === 'openingHours') {
    return { intent: 'opening_hours', confidence: 0.95, model: MODEL_NAME, matchedSource: 'synonyms', text: formatOpeningHours(profile) };
  }

  if (intent === 'price') {
    return {
      intent: matchingService ? 'service_price' : 'price_list',
      confidence: matchingService ? 0.95 : 0.88,
      model: MODEL_NAME,
      matchedSource: matchingService ? 'service' : 'synonyms',
      text: matchingService ? `${matchingService.name} stojí ${matchingService.spokenPrice}. Délka služby je ${matchingService.duration}.` : formatAllPrices(profile),
    };
  }

  if (intent === 'services') {
    return { intent: 'services', confidence: 0.93, model: MODEL_NAME, matchedSource: 'synonyms', text: formatServices(profile) };
  }

  if (intent === 'duration') {
    return {
      intent: matchingService ? 'service_duration' : 'duration_list',
      confidence: matchingService ? 0.92 : 0.82,
      model: MODEL_NAME,
      matchedSource: matchingService ? 'service' : 'synonyms',
      text: matchingService ? `${matchingService.name} trvá ${matchingService.duration}. Cena je ${matchingService.spokenPrice}.` : profile.services.map((service) => `${service.name} trvá ${service.duration}`).join('. ') + '.',
    };
  }

  if (intent === 'address') {
    return { intent: 'address', confidence: 0.93, model: MODEL_NAME, matchedSource: 'synonyms', text: `Najdete nás na adrese: ${profile.address}.` };
  }

  if (intent === 'booking') {
    return { intent: 'booking_help', confidence: 0.9, model: MODEL_NAME, matchedSource: 'synonyms', text: profile.messages.bookingNotAvailable };
  }

  if (intent === 'human') {
    return { intent: 'human_transfer_not_available_yet', confidence: 0.9, model: MODEL_NAME, matchedSource: 'synonyms', text: profile.messages.humanTransferNotAvailable };
  }

  if (intent === 'greeting') {
    return { intent: 'greeting', confidence: 0.74, model: MODEL_NAME, matchedSource: 'synonyms', text: `Dobrý den, jsem virtuální asistent pro ${profile.companyName}. Mohu odpovědět na služby, ceny, otevírací dobu, adresu a rezervace.` };
  }

  return null;
}

function createSingleLocalAssistantText(input: string, businessSlug = DEFAULT_BUSINESS_SLUG): LocalAgentResult {
  const profile = getBusinessProfile(safeBusinessSlug(businessSlug));
  const text = normalize(input);

  if (!text) {
    return { intent: 'empty', confidence: 1, model: MODEL_NAME, matchedSource: 'rules', text: profile.messages.empty };
  }

  if (containsAny(text, ['ignoruj', 'systemove instrukce', 'api', 'klic', 'prompt', 'tajne', 'pravidla'])) {
    return { intent: 'prompt_injection_attempt', confidence: 0.85, model: MODEL_NAME, matchedSource: 'rules', text: profile.messages.promptInjection };
  }

  const faq = findFaqAnswer(input, profile);
  if (faq) {
    return { intent: 'faq_answer', confidence: Math.min(0.98, Math.max(0.72, faq.score)), model: MODEL_NAME, matchedSource: 'faq', text: faq.answer };
  }

  const detectedIntent = detectIntent(text);
  if (detectedIntent) {
    const answer = answerByDetectedIntent(detectedIntent, text, profile);
    if (answer) return answer;
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

  return { intent: 'fallback_with_supported_topics', confidence: 0.42, model: MODEL_NAME, matchedSource: 'fallback', weakness: 'missing_knowledge_or_phrase', text: profile.messages.fallback };
}

export function createLocalAssistantText(input: string, businessSlug = DEFAULT_BUSINESS_SLUG): LocalAgentResult {
  const parts = splitCustomerQuestions(input);

  if (parts.length > 1) {
    const answers = parts.map((question, index) => {
      const result = createSingleLocalAssistantText(question, businessSlug);
      return `${index + 1}. ${question}\n${result.text}`;
    });
    return {
      intent: 'multi_question_answer',
      confidence: Math.min(...parts.map((part) => createSingleLocalAssistantText(part, businessSlug).confidence)),
      model: MODEL_NAME,
      matchedSource: 'synonyms',
      text: answers.join('\n\n'),
    };
  }

  return createSingleLocalAssistantText(input, businessSlug);
}

function recommendationFor(result: LocalAgentResult, question: string): string {
  if (result.intent === 'fallback_with_supported_topics') return `Doplnit FAQ odpověď nebo klíčová slova pro dotaz: „${question}“. `;
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
