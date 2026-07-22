import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('admin auth', () => {
  it('protects bookings list without admin password', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/bookings' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('admin_auth_required');
    await app.close();
  });

  it('accepts the development admin password', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', headers: { 'x-admin-password': 'admin' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authenticated).toBe(true);
    await app.close();
  });
});
