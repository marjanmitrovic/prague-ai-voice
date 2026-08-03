import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { bookingsToCsv, checkAvailability, createBooking, listAvailableSlots, listBookings } from '../business/bookings.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

function queryBusinessSlug(query: unknown): string {
  const value = (query as Record<string, string | undefined> | undefined)?.businessSlug;
  return safeBusinessSlug(value || DEFAULT_BUSINESS_SLUG);
}

export async function bookingsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/bookings', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = queryBusinessSlug(request.query);
    return { ok: true, businessSlug, bookings: listBookings(businessSlug) };
  });

  app.get('/api/bookings/export.csv', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = queryBusinessSlug(request.query);
    const csv = bookingsToCsv(listBookings(businessSlug));
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="prague-ai-voice-${businessSlug}-bookings.csv"`)
      .send(csv);
  });

  app.get('/api/bookings/availability', async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const availability = checkAvailability({
        businessSlug: queryBusinessSlug(query),
        serviceName: query.serviceName,
        date: query.date,
        time: query.time,
      });
      return { ok: true, availability };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Availability check failed';
      return reply.code(400).send({ ok: false, error: 'invalid_availability_request', message });
    }
  });

  app.get('/api/bookings/slots', async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const result = listAvailableSlots({ businessSlug: queryBusinessSlug(query), serviceName: query.serviceName, date: query.date });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Slots check failed';
      return reply.code(400).send({ ok: false, error: 'invalid_slots_request', message });
    }
  });

  app.post('/api/bookings', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const booking = await createBooking({ ...body, businessSlug: safeBusinessSlug(String(body.businessSlug || DEFAULT_BUSINESS_SLUG)) });
      request.log.info({ bookingId: booking.id, businessSlug: booking.businessSlug, serviceName: booking.serviceName }, 'Booking request created');
      return reply.code(201).send({ ok: true, booking });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Booking failed';
      return reply.code(400).send({ ok: false, error: 'invalid_booking', message });
    }
  });
}
