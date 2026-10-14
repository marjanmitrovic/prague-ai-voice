import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);

type CommandCandidate = {
  label: string;
  command: string;
  baseArgs: string[];
};

type PublicTtsError = {
  error: 'neural_tts_unavailable' | 'edge_tts_not_installed' | 'edge_tts_upstream_blocked';
  message: string;
  hint: string;
};

function getEdgeTtsCandidates(): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  if (env.EDGE_TTS_PYTHON) {
    candidates.push({
      label: `${env.EDGE_TTS_PYTHON} -m edge_tts`,
      command: env.EDGE_TTS_PYTHON,
      baseArgs: ['-m', 'edge_tts'],
    });
  }

  candidates.push(
    { label: 'python3 -m edge_tts', command: 'python3', baseArgs: ['-m', 'edge_tts'] },
    { label: 'python -m edge_tts', command: 'python', baseArgs: ['-m', 'edge_tts'] },
    { label: 'edge-tts', command: 'edge-tts', baseArgs: [] },
    { label: 'py -m edge_tts', command: 'py', baseArgs: ['-m', 'edge_tts'] },
  );

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command} ${candidate.baseArgs.join(' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.enum(['cs-CZ-VlastaNeural', 'cs-CZ-AntoninNeural']).optional(),
  engine: z.enum(['neural', 'edge-tts']).optional(),
});

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function rawErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown_error';
  }
}

function normalizeTtsError(error: unknown): PublicTtsError {
  const raw = rawErrorText(error);
  const lower = raw.toLowerCase();

  if (lower.includes('edge-tts is not available') || lower.includes('enoent') || lower.includes('not found')) {
    return {
      error: 'edge_tts_not_installed',
      message: 'Český hlas není na serveru dostupný.',
      hint: 'Zkontrolujte Docker image, instalaci edge-tts a proměnnou EDGE_TTS_PYTHON=/usr/bin/python3.',
    };
  }

  if (
    lower.includes('403') ||
    lower.includes('invalid response status') ||
    lower.includes('wss://speech.platform.bing.com') ||
    lower.includes('wssserverhandshakeerror') ||
    lower.includes('forbidden')
  ) {
    return {
      error: 'edge_tts_upstream_blocked',
      message: 'Český hlas je dočasně nedostupný, protože externí speech služba odmítla požadavek.',
      hint: 'Aplikace běží dál. Pro produkci je potřeba stabilní placený nebo smluvní voice provider místo bezplatného edge-tts endpointu.',
    };
  }

  return {
    error: 'neural_tts_unavailable',
    message: 'Český hlas je momentálně nedostupný.',
    hint: 'Zkontrolujte serverové logy na Renderu. Detail chyby je uložen jen v logu, neukazuje se zákazníkovi.',
  };
}

async function hasCommand(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 * 2 });
    return true;
  } catch {
    return false;
  }
}

async function findEdgeTtsCandidate(): Promise<CommandCandidate | null> {
  for (const candidate of getEdgeTtsCandidates()) {
    const ok = await hasCommand(candidate.command, [...candidate.baseArgs, '--list-voices']);
    if (ok) return candidate;
  }
  return null;
}

async function synthesizeWithEdgeTts(text: string, filePath: string, voice: string): Promise<{ commandLabel: string }> {
  const candidate = await findEdgeTtsCandidate();
  if (!candidate) {
    throw new Error('edge-tts is not available. On Render set EDGE_TTS_PYTHON=/usr/bin/python3.');
  }

  await execFileAsync(
    candidate.command,
    [
      ...candidate.baseArgs,
      '--voice', voice,
      '--rate=-4%',
      '--text', text,
      '--write-media', filePath,
    ],
    {
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return { commandLabel: candidate.label };
}

export async function ttsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/tts/status', async () => {
    const edgeCandidate = await findEdgeTtsCandidate();
    const edgeAvailable = Boolean(edgeCandidate);

    return {
      ok: edgeAvailable,
      preferredEngine: edgeAvailable ? 'edge-tts' : null,
      edgeTts: {
        ok: edgeAvailable,
        command: edgeCandidate?.label ?? null,
        voices: ['cs-CZ-VlastaNeural', 'cs-CZ-AntoninNeural'],
        defaultVoice: 'cs-CZ-VlastaNeural',
        paidApiRequired: false,
        quality: 'natural-neural',
      },
      browserFallbackDisabled: true,
      upstreamReliability: 'best-effort-free-endpoint',
      productionRecommendation: 'Pro živé telefonní hovory použijte stabilní voice gateway / TTS provider.',
      rateArgument: '--rate=-4%',
      note: 'Používá se pouze český Microsoft edge-tts neuralní MP3 hlas, ne browser speechSynthesis.',
    };
  });

  app.get('/api/tts/self-test', async (request, reply) => {
    const folder = path.join(tmpdir(), 'prague-ai-voice-tts');
    await mkdir(folder, { recursive: true });
    const mp3Path = path.join(folder, `${randomUUID()}.mp3`);

    try {
      const result = await synthesizeWithEdgeTts(
        'Dobrý den, toto je test českého neuralního hlasu Vlasta.',
        mp3Path,
        'cs-CZ-VlastaNeural',
      );
      await rm(mp3Path, { force: true });
      return { ok: true, engine: 'edge-tts', voice: 'cs-CZ-VlastaNeural', command: result.commandLabel, rateArgument: '--rate=-4%' };
    } catch (error) {
      await rm(mp3Path, { force: true });
      request.log.warn({ error }, 'Czech neural TTS self-test failed');
      return reply.code(503).send({
        ok: false,
        ...normalizeTtsError(error),
      });
    }
  });

  app.post('/api/tts/czech', async (request, reply) => {
    const parsed = ttsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const text = sanitizeForSpeech(parsed.data.text);
    const voice = parsed.data.voice ?? 'cs-CZ-VlastaNeural';
    const folder = path.join(tmpdir(), 'prague-ai-voice-tts');
    await mkdir(folder, { recursive: true });

    const mp3Path = path.join(folder, `${randomUUID()}.mp3`);

    try {
      const result = await synthesizeWithEdgeTts(text, mp3Path, voice);
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-TTS-Engine', 'edge-tts');
      reply.header('X-TTS-Command', result.commandLabel);
      reply.header('X-TTS-Voice', voice);
      reply.header('X-TTS-Rate', '-4%');
      return reply.send(createReadStream(mp3Path).on('close', () => {
        void rm(mp3Path, { force: true });
      }));
    } catch (error) {
      request.log.warn({ error }, 'Czech neural edge-tts failed');
      await rm(mp3Path, { force: true });
      return reply.code(503).send({
        ok: false,
        ...normalizeTtsError(error),
      });
    }
  });
}
