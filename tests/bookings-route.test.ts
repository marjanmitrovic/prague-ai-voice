import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('bookings route', () => {
  it('lists bookings', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/bookings', headers: { 'x-admin-password': 'admin' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    await app.close();
  });

  it('rejects booking outside working hours', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: {
        serviceName: 'Základní kosmetické ošetření',
        customerName: 'Test Klient',
        customerPhone: '+420111222333',
        date: '2099-07-20',
        time: '23:00',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('mimo pracovní dobu');
    await app.close();
  });

  it('returns available slots for a future working day', async () => {
    const app = await buildApp();
    const params = new URLSearchParams({
      serviceName: 'Základní kosmetické ošetření',
      date: '2099-07-20',
    });
    const res = await app.inject({ method: 'GET', url: `/api/bookings/slots?${params.toString()}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.slots)).toBe(true);
    await app.close();
  });
});
