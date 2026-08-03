import { randomUUID } from 'node:crypto';

export type CallStatus = 'created' | 'connected' | 'active' | 'completed' | 'failed';

export type CallEvent = {
  at: string;
  type: string;
  data: Record<string, unknown> | undefined;
};

export class CallSession {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  callSid?: string;
  streamSid?: string;
  status: CallStatus = 'created';
  mediaPackets = 0;
  mediaBytes = 0;
  events: CallEvent[] = [];
  error: string | undefined;

  addEvent(type: string, data?: Record<string, unknown>) {
    this.events.push({ at: new Date().toISOString(), type, data });
  }

  registerMediaPayload(payloadBase64: string) {
    this.mediaPackets += 1;
    this.mediaBytes += Buffer.byteLength(payloadBase64, 'base64');
  }

  complete(status: CallStatus, error?: string) {
    this.status = status;
    this.error = error;
    this.addEvent(status === 'completed' ? 'session_completed' : 'session_failed', error ? { error } : undefined);
  }

  toLogRecord() {
    const endedAt = new Date();
    return {
      id: this.id,
      callSid: this.callSid ?? null,
      streamSid: this.streamSid ?? null,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - this.createdAt.getTime(),
      mediaPackets: this.mediaPackets,
      mediaBytes: this.mediaBytes,
      error: this.error ?? null,
      events: this.events,
    };
  }
}
