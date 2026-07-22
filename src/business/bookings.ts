import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type BusinessService, type DayKey, getBusinessProfile } from './business-profile.js';
import { DEFAULT_BUSINESS_SLUG, insertBookingRow, listBookingRows, listBookingRowsForDate, safeBusinessSlug, type BookingRow } from '../storage-postgres.js';
import { sendBookingConfirmationEmails } from '../email.js';

const bookingRequestSchema = z.object({
  businessSlug: z.string().trim().regex(/^[a-z0-9-]+$/).optional().default(DEFAULT_BUSINESS_SLUG),
  serviceName: z.string().trim().min(1).max(120),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(5).max(40),
  customerEmail: z.string().trim().email().max(160).optional().or(z.literal('')).transform((value) => value || undefined),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(500).optional().default(''),
});

const storedBookingSchema = bookingRequestSchema.extend({
  id: z.string().uuid(),
  status: z.enum(['requested', 'cancelled']).default('requested'),
  startMinutes: z.number().int().min(0).max(1440).optional(),
  endMinutes: z.number().int().min(0).max(1440).optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  createdAt: z.string().datetime(),
});

const bookingsFileSchema = z.object({
  version: z.literal(1),
  bookings: z.array(storedBookingSchema),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export type StoredBooking = z.infer<typeof storedBookingSchema>;

export type AvailabilityResult = {
  ok: boolean;
  businessSlug: string;
  serviceName: string;
  date: string;
  time: string;
  durationMinutes: number;
  startMinutes: number;
  endMinutes: number;
  reason?: string;
};

const dayKeys: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function rowToBooking(row: BookingRow): StoredBooking {
  const booking: StoredBooking = {
    id: row.id,
    status: row.status === 'cancelled' ? 'cancelled' : 'requested',
    businessSlug: row.business_slug,
    serviceName: row.service_name,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    date: row.date,
    time: row.time,
    note: row.note ?? '',
    createdAt: row.created_at,
  };
  if (row.customer_email) booking.customerEmail = row.customer_email;
  if (row.start_minutes !== null) booking.startMinutes = row.start_minutes;
  if (row.end_minutes !== null) booking.endMinutes = row.end_minutes;
  if (row.duration_minutes !== null) booking.durationMinutes = row.duration_minutes;
  return booking;
}

export function readBookings(businessSlug?: string): StoredBooking[] {
  return listBookingRows(businessSlug).map(rowToBooking);
}

function parseMinutes(time: string): number {
  const [hoursText, minutesText] = time.split(':');
  const hours = Number(hoursText ?? '0');
  const minutes = Number(minutesText ?? '0');
  return hours * 60 + minutes;
}

function formatMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, Math.min(24 * 60, minutes));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getService(serviceName: string, businessSlug = DEFAULT_BUSINESS_SLUG): BusinessService | undefined {
  const profile = getBusinessProfile(businessSlug);
  return profile.services.find((service) => service.name === serviceName && service.bookingEnabled);
}

function serviceDurationMinutes(service: BusinessService): number {
  if (service.durationMinutes) return service.durationMinutes;
  const match = service.duration.match(/\d+/);
  return match ? Number(match[0]) : 30;
}

function dayKeyForDate(date: string): DayKey {
  const dayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dayKeys[dayIndex] ?? 'sunday';
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function bookingRange(booking: StoredBooking): { start: number; end: number } {
  const service = getService(booking.serviceName, booking.businessSlug);
  const duration = booking.durationMinutes ?? (service ? serviceDurationMinutes(service) : 30);
  const start = booking.startMinutes ?? parseMinutes(booking.time);
  return { start, end: booking.endMinutes ?? start + duration };
}

function isPastOrTooSoon(date: string, startMinutes: number, minNoticeMinutes: number): boolean {
  const [yearText, monthText, dayText] = date.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const start = new Date(year, month - 1, day, Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return start.getTime() < Date.now() + minNoticeMinutes * 60_000;
}

export function checkAvailability(input: unknown): AvailabilityResult {
  const parsed = bookingRequestSchema.pick({ businessSlug: true, serviceName: true, date: true, time: true }).safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid availability request: ${parsed.error.message}`);
  }

  const businessSlug = safeBusinessSlug(parsed.data.businessSlug);
  const profile = getBusinessProfile(businessSlug);
  const service = getService(parsed.data.serviceName, businessSlug);
  const startMinutes = parseMinutes(parsed.data.time);
  const durationMinutes = service ? serviceDurationMinutes(service) : 30;
  const endMinutes = startMinutes + durationMinutes;
  const base = {
    businessSlug,
    serviceName: parsed.data.serviceName,
    date: parsed.data.date,
    time: parsed.data.time,
    durationMinutes,
    startMinutes,
    endMinutes,
  };

  if (!service) return { ok: false, ...base, reason: 'Služba není dostupná pro rezervaci.' };
  if (endMinutes > 24 * 60) return { ok: false, ...base, reason: 'Termín přesahuje konec dne.' };

  const rules = profile.bookingRules;
  if (rules.closedDates.includes(parsed.data.date)) {
    return { ok: false, ...base, reason: 'Tento den je zavřeno.' };
  }

  if (isPastOrTooSoon(parsed.data.date, startMinutes, rules.minNoticeMinutes)) {
    return { ok: false, ...base, reason: `Termín je příliš brzy. Minimální předstih je ${rules.minNoticeMinutes} minut.` };
  }

  if (startMinutes % rules.slotMinutes !== 0) {
    return { ok: false, ...base, reason: `Čas musí být v intervalu po ${rules.slotMinutes} minutách.` };
  }

  const dayKey = dayKeyForDate(parsed.data.date);
  const workingIntervals = rules.workingHours[dayKey] ?? [];
  const fitsWorkingHours = workingIntervals.some((interval) => {
    const workStart = parseMinutes(interval.start);
    const workEnd = parseMinutes(interval.end);
    return startMinutes >= workStart && endMinutes <= workEnd;
  });

  if (!fitsWorkingHours) {
    return { ok: false, ...base, reason: 'Termín je mimo pracovní dobu nebo se do pracovní doby nevejde.' };
  }

  const buffer = rules.bufferMinutes;
  const bookings = listBookingRowsForDate(parsed.data.date, businessSlug).map(rowToBooking);
  const hasOverlap = bookings.some((booking) => {
    const range = bookingRange(booking);
    return overlaps(startMinutes - buffer, endMinutes + buffer, range.start, range.end);
  });

  if (hasOverlap) {
    return { ok: false, ...base, reason: 'Termín se překrývá s existující rezervací.' };
  }

  return { ok: true, ...base };
}

export function listAvailableSlots(input: unknown): { businessSlug: string; serviceName: string; date: string; slots: string[] } {
  const parsed = bookingRequestSchema.pick({ businessSlug: true, serviceName: true, date: true }).safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid slots request: ${parsed.error.message}`);
  }

  const businessSlug = safeBusinessSlug(parsed.data.businessSlug);
  const profile = getBusinessProfile(businessSlug);
  const service = getService(parsed.data.serviceName, businessSlug);
  if (!service || profile.bookingRules.closedDates.includes(parsed.data.date)) {
    return { businessSlug, serviceName: parsed.data.serviceName, date: parsed.data.date, slots: [] };
  }

  const duration = serviceDurationMinutes(service);
  const dayKey = dayKeyForDate(parsed.data.date);
  const intervals = profile.bookingRules.workingHours[dayKey] ?? [];
  const slots: string[] = [];

  for (const interval of intervals) {
    const workStart = parseMinutes(interval.start);
    const workEnd = parseMinutes(interval.end);
    for (let start = workStart; start + duration <= workEnd; start += profile.bookingRules.slotMinutes) {
      const time = formatMinutes(start);
      const availability = checkAvailability({ businessSlug, serviceName: parsed.data.serviceName, date: parsed.data.date, time });
      if (availability.ok) slots.push(time);
    }
  }

  return { businessSlug, serviceName: parsed.data.serviceName, date: parsed.data.date, slots };
}

export async function createBooking(input: unknown): Promise<StoredBooking> {
  const parsed = bookingRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid booking request: ${parsed.error.message}`);
  }

  const availability = checkAvailability(parsed.data);
  if (!availability.ok) {
    throw new Error(availability.reason ?? 'Selected time is not available');
  }

  const booking: StoredBooking = {
    ...parsed.data,
    id: randomUUID(),
    businessSlug: safeBusinessSlug(parsed.data.businessSlug),
    status: 'requested',
    startMinutes: availability.startMinutes,
    endMinutes: availability.endMinutes,
    durationMinutes: availability.durationMinutes,
    createdAt: new Date().toISOString(),
  };

  await insertBookingRow({
    id: booking.id,
    business_slug: booking.businessSlug,
    status: booking.status,
    service_name: booking.serviceName,
    customer_name: booking.customerName,
    customer_phone: booking.customerPhone,
    customer_email: booking.customerEmail ?? null,
    date: booking.date,
    time: booking.time,
    note: booking.note ?? '',
    start_minutes: booking.startMinutes ?? null,
    end_minutes: booking.endMinutes ?? null,
    duration_minutes: booking.durationMinutes ?? null,
    created_at: booking.createdAt,
    updated_at: booking.createdAt,
  });
  void sendBookingConfirmationEmails(booking);
  return booking;
}

export function listBookings(businessSlug?: string): StoredBooking[] {
  return readBookings(businessSlug).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function bookingsToCsv(bookings = listBookings()): string {
  const header = [
    'id',
    'status',
    'businessSlug',
    'date',
    'time',
    'serviceName',
    'durationMinutes',
    'customerName',
    'customerPhone',
    'customerEmail',
    'note',
    'createdAt',
  ];
  const rows = bookings.map((booking) => [
    booking.id,
    booking.status,
    booking.businessSlug,
    booking.date,
    booking.time,
    booking.serviceName,
    booking.durationMinutes ?? '',
    booking.customerName,
    booking.customerPhone,
    booking.customerEmail ?? '',
    booking.note ?? '',
    booking.createdAt,
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
}
