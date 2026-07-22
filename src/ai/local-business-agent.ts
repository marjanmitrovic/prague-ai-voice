import { getBusinessProfile, type BusinessProfile } from '../business/business-profile.js';

export type LocalAgentResult = {
  text: string;
  model: string;
  intent: string;
  confidence: number;
};

const MODEL_NAME = 'local-business-profile-rules-v1';

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

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

function findServiceQuestion(text: string, profile: BusinessProfile) {
  return profile.services.find((service) => {
    const normalizedName = normalize(service.name);
    const normalizedDescription = normalize(service.description);
    const words = normalizedName.split(' ').filter((word) => word.length >= 4);
    return text.includes(normalizedName) || text.includes(normalizedDescription) || words.some((word) => text.includes(word));
  });
}

export function createLocalAssistantText(input: string): LocalAgentResult {
  const profile = getBusinessProfile();
  const text = normalize(input);

  if (!text) {
    return {
      intent: 'empty',
      confidence: 1,
      model: MODEL_NAME,
      text: profile.messages.empty,
    };
  }

  if (containsAny(text, ['ignoruj', 'systemove instrukce', 'api', 'klic', 'prompt', 'tajne', 'pravidla'])) {
    return {
      intent: 'prompt_injection_attempt',
      confidence: 0.85,
      model: MODEL_NAME,
      text: profile.messages.promptInjection,
    };
  }

  if (containsAny(text, ['otevreno', 'oteviraci', 'otviraci', 'kdy mate', 'hodiny', 'pracovni doba', 'doba'])) {
    return {
      intent: 'opening_hours',
      confidence: 0.95,
      model: MODEL_NAME,
      text: formatOpeningHours(profile),
    };
  }

  if (containsAny(text, ['cena', 'kolik', 'stoji', 'korun', 'cenik', 'zaplatim']) || /(^|\s)kc($|\s)/.test(text)) {
    const matchingService = findServiceQuestion(text, profile);
    return {
      intent: matchingService ? 'service_price' : 'price_list',
      confidence: matchingService ? 0.95 : 0.88,
      model: MODEL_NAME,
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
      text: formatServices(profile),
    };
  }

  const matchingService = findServiceQuestion(text, profile);
  if (matchingService) {
    return {
      intent: 'service_detail',
      confidence: 0.82,
      model: MODEL_NAME,
      text: `${matchingService.name}: ${matchingService.description} Cena je ${matchingService.spokenPrice} a délka služby je ${matchingService.duration}.`,
    };
  }

  if (containsAny(text, ['rezervace', 'termin', 'objednat', 'objednani', 'volny termin', 'zarezervovat', 'rezervovat'])) {
    return {
      intent: 'booking_help',
      confidence: 0.9,
      model: MODEL_NAME,
      text: profile.messages.bookingNotAvailable,
    };
  }

  if (containsAny(text, ['clovek', 'pracovnik', 'operator', 'recepce', 'spojit', 'prepojit'])) {
    return {
      intent: 'human_transfer_not_available_yet',
      confidence: 0.9,
      model: MODEL_NAME,
      text: profile.messages.humanTransferNotAvailable,
    };
  }

  return {
    intent: 'fallback_with_supported_topics',
    confidence: 0.5,
    model: MODEL_NAME,
    text: profile.messages.fallback,
  };
}
