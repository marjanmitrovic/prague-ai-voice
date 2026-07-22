import { describe, expect, it, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleBookingConversation } from '../src/ai/booking-conversation.js';
import { reloadBusinessProfile } from '../src/business/business-profile.js';
import { resetDemoDataFromJsonSeed } from '../src/storage-postgres.js';

beforeEach(async () => {
  writeFileSync(resolve(process.cwd(), 'data', 'bookings.json'), JSON.stringify({ version: 1, bookings: [] }, null, 2), 'utf8');
  await resetDemoDataFromJsonSeed();
  reloadBusinessProfile();
});

describe('booking conversation', () => {
  it('creates a booking through multiple conversation turns', async () => {
    let result = await handleBookingConversation('Chci rezervaci');
    expect(result.state.stage).toBe('ask_service');

    result = await handleBookingConversation('Základní kosmetické ošetření', result.state);
    expect(result.state.stage).toBe('ask_date');

    result = await handleBookingConversation('2099-08-15', result.state);
    expect(result.state.stage).toBe('ask_time');

    result = await handleBookingConversation('10:00', result.state);
    expect(result.state.stage).toBe('ask_name');

    result = await handleBookingConversation('Jan Novak', result.state);
    expect(result.state.stage).toBe('ask_phone');

    result = await handleBookingConversation('+420111222333', result.state);
    expect(result.state.stage).toBe('confirm');

    result = await handleBookingConversation('ano', result.state);
    expect(result.state.stage).toBe('completed');
    expect(result.intent).toBe('booking_created');
    expect(result.booking).toBeTruthy();
  });

  it('collects booking details from one natural sentence', async () => {
    let result = await handleBookingConversation('Chci základní kosmetické ošetření dne 2099-08-15 v 10 hodin, jmenuji se Jan Novak, telefon +420111222333');
    expect(result.state.stage).toBe('confirm');
    expect(result.state.fields.serviceName).toBe('Základní kosmetické ošetření');
    expect(result.state.fields.date).toBe('2099-08-15');
    expect(result.state.fields.time).toBe('10:00');
    expect(result.state.fields.customerName).toBe('Jan Novak');
    expect(result.state.fields.customerPhone).toBe('+420111222333');

    result = await handleBookingConversation('ano', result.state);
    expect(result.intent).toBe('booking_created');
  });

  it('accepts date and time in the same answer when the conversation is already running', async () => {
    let result = await handleBookingConversation('Chci rezervaci');
    result = await handleBookingConversation('Úprava obočí', result.state);
    result = await handleBookingConversation('2099-08-16 v 11:30', result.state);
    expect(result.state.stage).toBe('ask_name');
    expect(result.state.fields.date).toBe('2099-08-16');
    expect(result.state.fields.time).toBe('11:30');
  });
});
