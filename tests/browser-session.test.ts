import { describe, expect, it } from 'vitest';
import { BrowserSession } from '../src/browser/browser-session.js';

describe('BrowserSession', () => {
  it('counts audio payload bytes', () => {
    const session = new BrowserSession();
    session.registerAudioPayload('/////w==');
    expect(session.audioPackets).toBe(1);
    expect(session.audioBytes).toBe(4);
  });

  it('creates completed log record', () => {
    const session = new BrowserSession();
    session.complete('completed');
    const record = session.toLogRecord();
    expect(record.status).toBe('completed');
    expect(record.error).toBeNull();
  });
});
