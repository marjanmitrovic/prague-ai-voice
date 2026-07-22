import { randomUUID } from 'node:crypto';

export type BrowserSessionStatus = 'created' | 'connected' | 'active' | 'completed' | 'failed';

export type BrowserSessionEvent = {
  at: string;
  type: string;
  data?: Record<string, unknown>;
};

export class BrowserSession {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  status: BrowserSessionStatus = 'created';
  audioPackets = 0;
  audioBytes = 0;
  textMessages = 0;
  events: BrowserSessionEvent[] = [];
  error: string | undefined;

  addEvent(type: string, data?: Record<string, unknown>): void {
    const event: BrowserSessionEvent = { at: new Date().toISOString(), type };
    if (data !== undefined) event.data = data;
    this.events.push(event);
  }

  registerAudioPayload(payloadBase64: string): void {
    this.audioPackets += 1;
    this.audioBytes += Buffer.byteLength(payloadBase64, 'base64');
  }

  registerText(): void {
    this.textMessages += 1;
  }

  complete(status: BrowserSessionStatus, error?: string): void {
    this.status = status;
    this.error = error;
    this.addEvent(status === 'completed' ? 'session_completed' : 'session_failed', error ? { error } : undefined);
  }

  toLogRecord() {
    const endedAt = new Date();
    return {
      id: this.id,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - this.createdAt.getTime(),
      audioPackets: this.audioPackets,
      audioBytes: this.audioBytes,
      textMessages: this.textMessages,
      error: this.error ?? null,
      events: this.events,
    };
  }
}
