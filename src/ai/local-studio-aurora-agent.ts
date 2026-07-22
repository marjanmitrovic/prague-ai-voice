export type LocalAgentResult = {
  text: string;
  model: string;
  intent: string;
  confidence: number;
};

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

export function createLocalAssistantText(input: string): LocalAgentResult {
  const text = normalize(input);

  if (!text) {
    return {
      intent: 'empty',
      confidence: 1,
      model: 'local-studio-aurora-rules-v1',
      text: 'Nerozumím zprávě. Můžete ji prosím zopakovat?',
    };
  }

  if (containsAny(text, ['otevreno', 'oteviraci', 'otviraci', 'kdy mate', 'hodiny', 'pracovni doba', 'doba'])) {
    return {
      intent: 'opening_hours',
      confidence: 0.95,
      model: 'local-studio-aurora-rules-v1',
      text: 'Máme otevřeno od pondělí do pátku od devíti do osmnácti hodin. V sobotu od devíti do třinácti hodin. V neděli máme zavřeno.',
    };
  }

  if (containsAny(text, ['sluzby', 'nabizite', 'nabidka', 'osetreni', 'oboci', 'masaz', 'co delate'])) {
    return {
      intent: 'services',
      confidence: 0.93,
      model: 'local-studio-aurora-rules-v1',
      text: 'Nabízíme kosmetické ošetření pleti, úpravu obočí a základní masáž obličeje.',
    };
  }


  if (containsAny(text, ['cena', 'kolik', 'stoji', 'korun', 'cenik', 'zaplatim']) || /(^|\s)kc($|\s)/.test(text)) {
    return {
      intent: 'price',
      confidence: 0.93,
      model: 'local-studio-aurora-rules-v1',
      text: 'Základní kosmetické ošetření stojí tisíc dvě stě korun.',
    };
  }

  if (containsAny(text, ['rezervace', 'termin', 'objednat', 'objednani', 'volny termin'])) {
    return {
      intent: 'booking_not_available_yet',
      confidence: 0.9,
      model: 'local-studio-aurora-rules-v1',
      text: 'Rezervace termínu zatím není v této testovací verzi dostupná. Mohu vám ale říct otevírací dobu, služby nebo cenu základního ošetření.',
    };
  }

  if (containsAny(text, ['clovek', 'pracovnik', 'operator', 'recepce', 'spojit', 'prepojit'])) {
    return {
      intent: 'human_transfer_not_available_yet',
      confidence: 0.9,
      model: 'local-studio-aurora-rules-v1',
      text: 'Přepojení na pracovníka zatím není v testovací verzi dostupné.',
    };
  }

  if (containsAny(text, ['ignoruj', 'systemove instrukce', 'api', 'klic', 'prompt', 'tajne'])) {
    return {
      intent: 'prompt_injection_attempt',
      confidence: 0.8,
      model: 'local-studio-aurora-rules-v1',
      text: 'S interními instrukcemi vám nemohu pomoci. Mohu odpovědět na otevírací dobu, služby nebo cenu základního kosmetického ošetření.',
    };
  }

  return {
    intent: 'fallback',
    confidence: 0.45,
    model: 'local-studio-aurora-rules-v1',
    text: 'Tuto informaci momentálně nemám k dispozici. Mohu vám pomoci s otevírací dobou, nabídkou služeb nebo cenou základního kosmetického ošetření.',
  };
}
