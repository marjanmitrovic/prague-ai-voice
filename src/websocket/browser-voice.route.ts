import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { BrowserSession } from '../browser/browser-session.js';
import { writeBrowserSessionLog } from '../logging/session-logger.js';

type ClientMessage =
  | { type: 'hello'; userAgent?: string }
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType?: string; payload: string }
  | { type: 'stop' };

function parseClientMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('message_missing_type');
  }
  const message = parsed as Record<string, unknown>;

  if (message.type === 'hello') {
    const result: ClientMessage = { type: 'hello' };
    if (typeof message.userAgent === 'string') result.userAgent = message.userAgent;
    return result;
  }
  if (message.type === 'text' && typeof message.text === 'string') {
    return { type: 'text', text: message.text };
  }
  if (message.type === 'audio' && typeof message.payload === 'string') {
    const result: ClientMessage = { type: 'audio', payload: message.payload };
    if (typeof message.mimeType === 'string') result.mimeType = message.mimeType;
    return result;
  }
  if (message.type === 'stop') {
    return { type: 'stop' };
  }
  throw new Error('unsupported_message');
}

export async function browserVoiceRoute(app: FastifyInstance): Promise<void> {
  app.get('/ws/browser', { websocket: true }, (socket, request) => {
    const session = new BrowserSession();
    let closed = false;
    let timeout: NodeJS.Timeout | undefined;

    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    const closeSession = async (status: 'completed' | 'failed', error?: string) => {
      if (closed) return;
      closed = true;
      if (timeout) clearTimeout(timeout);
      session.complete(status, error);
      try {
        const logPath = await writeBrowserSessionLog(session);
        request.log.info({ sessionId: session.id, logPath }, 'Browser voice session saved');
      } catch (writeError) {
        request.log.error({ err: writeError, sessionId: session.id }, 'Failed to write browser voice session log');
      }
    };

    timeout = setTimeout(() => {
      session.addEvent('timeout', { maxSeconds: env.POC_MAX_SESSION_SECONDS });
      send({ type: 'error', error: 'timed_out' });
      socket.close(1000, 'max session duration reached');
      void closeSession('failed', 'timed_out');
    }, env.POC_MAX_SESSION_SECONDS * 1000);

    session.status = 'connected';
    session.addEvent('websocket_connected', { remoteAddress: request.ip });
    send({ type: 'ready', sessionId: session.id, message: 'Browser voice WebSocket is ready.' });

    socket.on('message', (message: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = message.toString();
      try {
        const event = parseClientMessage(raw);
        if (event.type === 'hello') {
          session.addEvent('browser_hello', { userAgent: event.userAgent });
          return send({ type: 'ack', event: 'hello' });
        }
        if (event.type === 'text') {
          session.status = 'active';
          session.registerText();
          session.addEvent('browser_text', { length: event.text.length });
          return send({ type: 'assistant_text', text: `Test OK. Primio sam tekst: ${event.text}` });
        }
        if (event.type === 'audio') {
          session.status = 'active';
          session.registerAudioPayload(event.payload);
          if (session.audioPackets === 1 || session.audioPackets % 10 === 0) {
            session.addEvent('browser_audio_progress', {
              packets: session.audioPackets,
              bytes: session.audioBytes,
              mimeType: event.mimeType,
            });
          }
          return send({ type: 'ack', event: 'audio', packets: session.audioPackets, bytes: session.audioBytes });
        }
        if (event.type === 'stop') {
          session.addEvent('browser_stop');
          send({ type: 'done', sessionId: session.id });
          socket.close(1000, 'browser stop received');
          return void closeSession('completed');
        }
      } catch (error) {
        session.addEvent('invalid_message');
        request.log.warn({ err: error, sessionId: session.id }, 'Invalid browser voice message');
        send({ type: 'error', error: 'invalid_message' });
      }
    });

    socket.on('close', () => {
      void closeSession(session.status === 'failed' ? 'failed' : 'completed');
    });

    socket.on('error', (error: Error) => {
      request.log.error({ err: error, sessionId: session.id }, 'Browser voice socket error');
      void closeSession('failed', 'socket_error');
    });
  });
}
