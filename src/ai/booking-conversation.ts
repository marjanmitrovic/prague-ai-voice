import { z } from 'zod';
import { createBooking } from '../business/bookings.js';
import { getBusinessProfile, type BusinessProfile, type BusinessService } from '../business/business-profile.js';

const bookingFieldsSchema = z.object({
  serviceName: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
});

const conversationStateSchema = z.object({
  stage: z
    .enum(['idle', 'ask_service', 'ask_date', 'ask_time', 'ask_name', 'ask_phone', 'confirm', 'completed', 'cancelled'])
    .default('idle'),
  fields: bookingFieldsSchema.default({}),
  lastError: z.string().optional(),
});

export type BookingConversationState = z.infer<typeof conversationStateSchema>;

export type BookingConversationResult = {
  text: string;
  intent: string;
  state: BookingConversationState;
  booking?: unknown;
  actions: string[];
};

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+\s.:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

function publicState(state: BookingConversationState): BookingConversationState {
  return { stage: state.stage, fields: { ...state.fields }, lastError: state.lastError };
}

function servicesForBooking(profile: BusinessProfile): BusinessService[] {
  return profile.services.filter((service) => service.bookingEnabled);
}

function serviceListText(profile: BusinessProfile): string {
  const services = servicesForBooking(profile).map((service, index) => `${index + 1}. ${service.name} (${service.duration}, ${service.spokenPrice})`);
  return services.length ? services.join('; ') : 'Momentálně není dostupná žádná služba pro rezervaci.';
}

function findService(input: string, profile: BusinessProfile): BusinessService | undefined {
  const text = normalize(input);
  const numberMatch = text.match(/(?:^|\s)(\d+)(?:\s|$)/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    const service = servicesForBooking(profile)[index];
    if (service) return service;
  }

  return servicesForBooking(profile).find((service) => {
    const name = normalize(service.name);
    const words = name.split(' ').filter((word) => word.length >= 4);
    return text.includes(name) || words.some((word) => text.includes(word));
  });
}

function isoDateFromParts(dayValue: string | number, monthValue: string | number, yearValue?: string | number): string | undefined {
  const now = new Date();
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = yearValue ? Number(yearValue) : now.getFullYear();
  if (!Number.isInteger(day) || !Number.isInteger(month) || day < 1 || day > 31 || month < 1 || month > 12 || year < 2020 || year > 2099) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(base: Date, days: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextWeekday(targetDay: number, includeToday = false): string {
  const now = new Date();
  const today = now.getDay();
  let delta = (targetDay - today + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(now, delta);
}

function parseDate(input: string): string | undefined {
  const text = normalize(input);
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dotted = text.match(/\b(\d{1,2})[.]\s*(\d{1,2})[.]?\s*(20\d{2})?\b/);
  if (dotted?.[1] && dotted?.[2]) return isoDateFromParts(dotted[1], dotted[2], dotted[3]);

  const monthNames: Record<string, number> = {
    ledna: 1,
    leden: 1,
    unora: 2,
    unor: 2,
    brezna: 3,
    brezen: 3,
    dubna: 4,
    duben: 4,
    kvetna: 5,
    kveten: 5,
    cervna: 6,
    cerven: 6,
    cervence: 7,
    cervenec: 7,
    srpna: 8,
    srpen: 8,
    zari: 9,
    rijna: 10,
    rijen: 10,
    listopadu: 11,
    listopad: 11,
    prosince: 12,
    prosinec: 12,
  };
  const spokenMonth = text.match(/\b(\d{1,2})[.]?\s+(ledna|leden|unora|unor|brezna|brezen|dubna|duben|kvetna|kveten|cervna|cerven|cervence|cervenec|srpna|srpen|zari|rijna|rijen|listopadu|listopad|prosince|prosinec)(?:\s+(20\d{2}))?\b/);
  if (spokenMonth?.[1] && spokenMonth?.[2]) return isoDateFromParts(spokenMonth[1], monthNames[spokenMonth[2]] ?? 1, spokenMonth[3]);

  const now = new Date();
  if (containsAny(text, ['dnes'])) return now.toISOString().slice(0, 10);
  if (containsAny(text, ['pozitri', 'po zitri'])) return addDays(now, 2);
  if (containsAny(text, ['zitra', 'zitrek'])) return addDays(now, 1);

  const weekdays: Array<[string[], number]> = [
    [['nedele', 'nedeli'], 0],
    [['pondeli'], 1],
    [['utery'], 2],
    [['streda', 'stredu'], 3],
    [['ctvrtek'], 4],
    [['patek'], 5],
    [['sobota', 'sobotu'], 6],
  ];
  for (const [terms, day] of weekdays) {
    if (containsAny(text, terms)) return nextWeekday(day, containsAny(text, ['dnes']));
  }
  return undefined;
}

function parseTime(input: string): string | undefined {
  const text = normalize(input);
  const colonMatch = text.match(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\b/);
  if (colonMatch) return `${String(Number(colonMatch[1])).padStart(2, '0')}:${colonMatch[2]}`;

  const hourMatch = text.match(/(?:\bv\s*)?\b([01]?\d|2[0-3])\s*(?:hodin|hod|h)\b/);
  if (hourMatch) return `${String(Number(hourMatch[1])).padStart(2, '0')}:00`;

  const bareAfterTimeWords = text.match(/(?:cas|termin|v|na)\s+([01]?\d|2[0-3])\b/);
  if (bareAfterTimeWords) return `${String(Number(bareAfterTimeWords[1])).padStart(2, '0')}:00`;

  return undefined;
}

function normalizePhoneCandidate(candidate: string): string | undefined {
  const cleaned = candidate.replace(/[^+\d]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return undefined;
  if (cleaned.startsWith('+')) return cleaned;
  if (digits.length === 9) return `+420${digits}`;
  return `+${digits}`;
}

function parsePhone(input: string): string | undefined {
  const explicit = input.match(/(?:telefon|tel|číslo|cislo)\s*[: je]*\s*(\+?\d[\d\s.-]{7,}\d)/i);
  if (explicit?.[1]) return normalizePhoneCandidate(explicit[1]);
  return normalizePhoneCandidate(input);
}

function parseName(input: string): string | undefined {
  const original = input.trim().replace(/\s+/g, ' ');
  const direct = original.match(/(?:jmenuji se|jmenuju se|jméno je|jmeno je|na jméno|na jmeno)\s+(.+?)(?:,|\.|\s+(?:telefon|tel|číslo|cislo|datum|zítra|zitra|v\s+\d|dne|na\s+\d)|$)/i);
  const candidate = direct?.[1]?.trim();
  if (candidate && candidate.length >= 2 && !/\d{4,}/.test(candidate)) return candidate.slice(0, 120);
  return undefined;
}

function extractFieldsFromMessage(input: string, state: BookingConversationState, profile: BusinessProfile): { fields: BookingConversationState['fields']; actions: string[] } {
  const fields = { ...state.fields };
  const actions: string[] = [];
  const service = !fields.serviceName ? findService(input, profile) : undefined;
  const date = !fields.date ? parseDate(input) : undefined;
  const time = !fields.time ? parseTime(input) : undefined;
  const phone = !fields.customerPhone ? parsePhone(input) : undefined;
  const name = !fields.customerName ? parseName(input) : undefined;

  if (service) {
    fields.serviceName = service.name;
    actions.push('set_service');
  }
  if (date) {
    fields.date = date;
    actions.push('set_date');
  }
  if (time) {
    fields.time = time;
    actions.push('set_time');
  }
  if (name) {
    fields.customerName = name;
    actions.push('set_name');
  }
  if (phone) {
    fields.customerPhone = phone;
    actions.push('set_phone');
  }

  return { fields, actions };
}

function collectedSummary(state: BookingConversationState): string {
  const values = [
    state.fields.serviceName ? `služba ${state.fields.serviceName}` : undefined,
    state.fields.date ? `datum ${state.fields.date}` : undefined,
    state.fields.time ? `čas ${state.fields.time}` : undefined,
    state.fields.customerName ? `jméno ${state.fields.customerName}` : undefined,
    state.fields.customerPhone ? `telefon ${state.fields.customerPhone}` : undefined,
  ].filter(Boolean);
  return values.length ? `Rozpoznal jsem: ${values.join(', ')}. ` : '';
}

function hasWholeTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => new RegExp(`(?:^|\\s)${term}(?:\\s|$)`).test(text));
}

function isYes(input: string): boolean {
  const text = normalize(input);
  return hasWholeTerm(text, ['ano', 'jo', 'jasne', 'potvrzuji', 'souhlasim', 'spravne', 'ok']) || text.includes('muze byt');
}

function isNo(input: string): boolean {
  const text = normalize(input);
  return hasWholeTerm(text, ['ne', 'zrusit', 'storno', 'stop', 'konec', 'nechci']);
}

function confirmationText(state: BookingConversationState): string {
  return `Prosím potvrďte rezervaci: ${state.fields.serviceName}, ${state.fields.date} v ${state.fields.time}, jméno ${state.fields.customerName}, telefon ${state.fields.customerPhone}. Je to správně?`;
}

function nextQuestion(state: BookingConversationState, profile: BusinessProfile): string {
  switch (state.stage) {
    case 'ask_service':
      return `Jakou službu si přejete rezervovat? Dostupné služby: ${serviceListText(profile)}`;
    case 'ask_date':
      return 'Na jaký datum si přejete rezervaci? Můžete napsat například 2026-08-15 nebo 15.8.2026.';
    case 'ask_time':
      return 'V kolik hodin si přejete termín? Napište například 10:30 nebo 14:00.';
    case 'ask_name':
      return 'Na jaké jméno mám rezervaci zapsat?';
    case 'ask_phone':
      return 'Jaké je vaše telefonní číslo pro potvrzení rezervace?';
    case 'confirm':
      return confirmationText(state);
    default:
      return 'Mohu vám pomoci s rezervací termínu. Napište například: Chci rezervaci.';
  }
}

function advanceToMissingField(state: BookingConversationState): BookingConversationState {
  if (!state.fields.serviceName) return { ...state, stage: 'ask_service' };
  if (!state.fields.date) return { ...state, stage: 'ask_date' };
  if (!state.fields.time) return { ...state, stage: 'ask_time' };
  if (!state.fields.customerName) return { ...state, stage: 'ask_name' };
  if (!state.fields.customerPhone) return { ...state, stage: 'ask_phone' };
  return { ...state, stage: 'confirm' };
}

export async function handleBookingConversation(message: string, rawState?: unknown): Promise<BookingConversationResult> {
  const profile = getBusinessProfile();
  let state = conversationStateSchema.parse(rawState ?? { stage: 'idle', fields: {} });
  const input = message.trim();
  const text = normalize(input);
  const actions: string[] = [];
  const previousStage = state.stage;

  if (state.stage !== 'confirm') {
    const extracted = extractFieldsFromMessage(input, state, profile);
    state = advanceToMissingField({ ...state, fields: extracted.fields });
    actions.push(...extracted.actions);
  }

  if (isNo(input) && state.stage !== 'idle') {
    state = { stage: 'cancelled', fields: state.fields };
    return { intent: 'booking_cancelled', actions: ['cancel'], state: publicState(state), text: 'Rezervace byla zrušena. Mohu pomoci s něčím dalším?' };
  }

  if (actions.length > 0 && previousStage !== 'idle' && previousStage !== state.stage) {
    const intent = state.stage === 'confirm' ? 'booking_confirm' : 'booking_collecting';
    return { intent, actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
  }

  if (rawState == null || conversationStateSchema.parse(rawState ?? { stage: 'idle', fields: {} }).stage === 'idle') {
    if (!containsAny(text, ['rezervace', 'termin', 'objednat', 'objednani', 'volny termin']) && actions.length === 0) {
      state = advanceToMissingField({ stage: 'ask_service', fields: state.fields });
      return { intent: 'booking_started', actions: ['start_booking'], state: publicState(state), text: nextQuestion(state, profile) };
    }
    actions.unshift('start_booking');
    const summary = collectedSummary(state);
    return { intent: state.stage === 'confirm' ? 'booking_confirm' : 'booking_collecting', actions, state: publicState(state), text: `${summary}${nextQuestion(state, profile)}` };
  }

  if (state.stage === 'ask_service') {
    if (state.fields.serviceName) {
      return { intent: 'booking_collecting', actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
    }
    const service = findService(input, profile);
    if (!service) {
      return { intent: 'booking_service_missing', actions, state: publicState(state), text: `Tuto službu jsem nenašel. ${nextQuestion(state, profile)}` };
    }
    state = advanceToMissingField({ ...state, fields: { ...state.fields, serviceName: service.name } });
    actions.push('set_service');
    return { intent: 'booking_collecting', actions, state: publicState(state), text: `Vybraná služba: ${service.name}. ${nextQuestion(state, profile)}` };
  }

  if (state.stage === 'ask_date') {
    if (state.fields.date) return { intent: 'booking_collecting', actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
    const date = parseDate(input);
    if (!date) return { intent: 'booking_date_missing', actions, state: publicState(state), text: 'Datum jsem nerozpoznal. Napište prosím datum ve formátu 2026-08-15, 15.8.2026, zítra nebo příští pondělí.' };
    state = advanceToMissingField({ ...state, fields: { ...state.fields, date } });
    actions.push('set_date');
    return { intent: 'booking_collecting', actions, state: publicState(state), text: `Datum: ${date}. ${nextQuestion(state, profile)}` };
  }

  if (state.stage === 'ask_time') {
    if (state.fields.time) return { intent: 'booking_collecting', actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
    const time = parseTime(input);
    if (!time) return { intent: 'booking_time_missing', actions, state: publicState(state), text: 'Čas jsem nerozpoznal. Napište prosím čas například 10:30, 14:00 nebo v 10 hodin.' };
    state = advanceToMissingField({ ...state, fields: { ...state.fields, time } });
    actions.push('set_time');
    return { intent: 'booking_collecting', actions, state: publicState(state), text: `Čas: ${time}. ${nextQuestion(state, profile)}` };
  }

  if (state.stage === 'ask_name') {
    if (state.fields.customerName) return { intent: 'booking_collecting', actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
    if (input.length < 2 || /\d{4,}/.test(input)) return { intent: 'booking_name_missing', actions, state: publicState(state), text: 'Jméno jsem nerozpoznal. Napište prosím jméno a příjmení.' };
    state = advanceToMissingField({ ...state, fields: { ...state.fields, customerName: input.slice(0, 120) } });
    actions.push('set_name');
    return { intent: 'booking_collecting', actions, state: publicState(state), text: `${nextQuestion(state, profile)}` };
  }

  if (state.stage === 'ask_phone') {
    if (state.fields.customerPhone) return { intent: 'booking_confirm', actions, state: publicState(state), text: `${collectedSummary(state)}${nextQuestion(state, profile)}` };
    const phone = parsePhone(input);
    if (!phone) return { intent: 'booking_phone_missing', actions, state: publicState(state), text: 'Telefon jsem nerozpoznal. Napište prosím číslo, například +420111222333.' };
    state = advanceToMissingField({ ...state, fields: { ...state.fields, customerPhone: phone } });
    actions.push('set_phone');
    return { intent: 'booking_confirm', actions, state: publicState(state), text: nextQuestion(state, profile) };
  }

  if (state.stage === 'confirm') {
    if (!isYes(input)) return { intent: 'booking_confirmation_missing', actions, state: publicState(state), text: 'Pro uložení rezervace prosím odpovězte ano. Pokud chcete skončit, napište zrušit.' };
    try {
      const booking = await createBooking({
        serviceName: state.fields.serviceName,
        date: state.fields.date,
        time: state.fields.time,
        customerName: state.fields.customerName,
        customerPhone: state.fields.customerPhone,
        note: 'Rezervace vytvořená konverzačním tokem v browser POC.',
      });
      state = { stage: 'completed', fields: state.fields };
      actions.push('create_booking');
      return {
        intent: 'booking_created',
        actions,
        state: publicState(state),
        booking,
        text: `Rezervace je uložena: ${booking.serviceName}, ${booking.date} v ${booking.time}. Děkujeme, ${booking.customerName}.`,
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Termín není dostupný.';
      state = { ...state, stage: 'ask_time', lastError: messageText };
      return {
        intent: 'booking_failed_availability',
        actions: ['booking_failed'],
        state: publicState(state),
        text: `Termín nelze uložit: ${messageText} Zkuste prosím jiný čas.`,
      };
    }
  }

  state = advanceToMissingField(state);
  return { intent: 'booking_collecting', actions, state: publicState(state), text: nextQuestion(state, profile) };
}
