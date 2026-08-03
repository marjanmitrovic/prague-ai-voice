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
    { label: 'py -m edge_tts', command: 'py', baseArgs: ['-m', 'edge_tts'] },
    { label: 'python -m edge_tts', command: 'python', baseArgs: ['-m', 'edge_tts'] },
    { label: 'edge-tts', command: 'edge-tts', baseArgs: [] },
  );
  return candidates;
}

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.enum(['cs-CZ-AntoninNeural', 'cs-CZ-VlastaNeural']).optional(),
  engine: z.enum(['neural', 'auto', 'edge-tts', 'espeak-ng']).optional(),
});

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

async function hasCommand(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 });
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
    throw new Error('edge-tts is not available. Install it with: py -m pip install --user edge-tts, or set EDGE_TTS_PYTHON to the full python.exe path.');
  }

  await execFileAsync(
    candidate.command,
    [
      ...candidate.baseArgs,
      '--voice', voice,
      '--rate', '-4%',
      '--pitch', '+0Hz',
      '--text', text,
      '--write-media', filePath,
    ],
    {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return { commandLabel: candidate.label };
}

async function synthesizeWithEspeak(text: string, filePath: string): Promise<void> {
  await execFileAsync('espeak-ng', ['-v', 'cs', '-s', '142', '-p', '35', '-a', '170', '-w', filePath, text], {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

export async function ttsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/tts/status', async () => {
    const edgeCandidate = await findEdgeTtsCandidate();
    const edgeAvailable = Boolean(edgeCandidate);
    const espeakAvailable = await hasCommand('espeak-ng', ['--version']);

    return {
      ok: edgeAvailable || espeakAvailable,
      preferredEngine: edgeAvailable ? 'edge-tts' : espeakAvailable ? 'espeak-ng' : null,
      edgeTts: {
        ok: edgeAvailable,
        command: edgeCandidate?.label ?? null,
        voices: ['cs-CZ-AntoninNeural', 'cs-CZ-VlastaNeural'],
        paidApiRequired: false,
        quality: 'natural-neural',
      },
      espeakNg: {
        ok: espeakAvailable,
        voice: 'cs',
        paidApiRequired: false,
        quality: 'robotic-offline-fallback',
      },
    };
  });

  app.post('/api/tts/czech', async (request, reply) => {
    const parsed = ttsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const text = sanitizeForSpeech(parsed.data.text);
    const requestedEngine = parsed.data.engine ?? 'neural';
    const voice = parsed.data.voice ?? 'cs-CZ-VlastaNeural';
    const folder = path.join(tmpdir(), 'prague-ai-voice-tts');
    await mkdir(folder, { recursive: true });

    const mp3Path = path.join(folder, `${randomUUID()}.mp3`);
    const wavPath = path.join(folder, `${randomUUID()}.wav`);

    if (requestedEngine === 'neural' || requestedEngine === 'auto' || requestedEngine === 'edge-tts') {
      try {
        const result = await synthesizeWithEdgeTts(text, mp3Path, voice);
        reply.header('Content-Type', 'audio/mpeg');
        reply.header('Cache-Control', 'no-store');
        reply.header('X-TTS-Engine', 'edge-tts');
        reply.header('X-TTS-Command', result.commandLabel);
        reply.header('X-TTS-Voice', voice);
        return reply.send(createReadStream(mp3Path).on('close', () => {
          void rm(mp3Path, { force: true });
        }));
      } catch (error) {
        request.log.warn({ error }, 'Neural Czech TTS failed');
        await rm(mp3Path, { force: true });
        if (requestedEngine === 'neural' || requestedEngine === 'edge-tts') {
          return reply.code(503).send({
            error: 'neural_tts_unavailable',
            message: error instanceof Error ? error.message : 'edge-tts neural voice is unavailable',
          });
        }
      }
    }

    try {
      await synthesizeWithEspeak(text, wavPath);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-TTS-Engine', 'espeak-ng');
      reply.header('X-TTS-Voice', 'cs');
      return reply.send(createReadStream(wavPath).on('close', () => {
        void rm(wavPath, { force: true });
      }));
    } catch (error) {
      request.log.warn({ error }, 'Fallback Czech TTS failed');
      await rm(wavPath, { force: true });
      return reply.code(503).send({
        error: 'tts_unavailable',
        message: 'No Czech TTS engine is available. Install edge-tts with: py -m pip install --user edge-tts, or set EDGE_TTS_PYTHON to the full python.exe path.',
      });
    }
  });
}
