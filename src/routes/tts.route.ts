import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
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

type CommandCheck = {
  label: string;
  ok: boolean;
  error?: string;
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
    { label: 'py -m edge_tts', command: 'py', baseArgs: ['-m', 'edge_tts'] },
    { label: 'edge-tts', command: 'edge-tts', baseArgs: [] },
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

async function checkCommand(command: string, args: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await execFileAsync(command, args, { timeout: 9000, windowsHide: true, maxBuffer: 1024 * 1024 * 2 });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.slice(0, 500) };
  }
}

async function hasCommand(command: string, args: string[]): Promise<boolean> {
  return (await checkCommand(command, args)).ok;
}

async function findEdgeTtsCandidate(): Promise<{ candidate: CommandCandidate | null; checks: CommandCheck[] }> {
  const checks: CommandCheck[] = [];

  for (const candidate of getEdgeTtsCandidates()) {
    const check = await checkCommand(candidate.command, [...candidate.baseArgs, '--list-voices']);
    checks.push({ label: candidate.label, ok: check.ok, ...(check.ok ? {} : { error: check.error }) });
    if (check.ok) return { candidate, checks };
  }

  return { candidate: null, checks };
}

async function assertGeneratedAudio(filePath: string, label: string): Promise<number> {
  const file = await stat(filePath);
  if (file.size < 1000) {
    throw new Error(`${label} vytvořil příliš malý audio soubor (${file.size} B).`);
  }
  return file.size;
}

async function synthesizeWithEdgeTts(text: string, filePath: string, voice: string): Promise<{ commandLabel: string; bytes: number }> {
  const edge = await findEdgeTtsCandidate();
  if (!edge.candidate) {
    const details = edge.checks.map((item) => `${item.label}: ${item.ok ? 'OK' : item.error}`).join(' | ');
    throw new Error(`edge-tts není dostupný. Detaily: ${details}`);
  }

  await execFileAsync(
    edge.candidate.command,
    [
      ...edge.candidate.baseArgs,
      '--voice', voice,
      '--rate', '-4%',
      '--pitch', '+0Hz',
      '--text', text,
      '--write-media', filePath,
    ],
    {
      timeout: 45000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return { commandLabel: edge.candidate.label, bytes: await assertGeneratedAudio(filePath, 'edge-tts') };
}

async function synthesizeWithEspeak(text: string, filePath: string): Promise<number> {
  await execFileAsync('espeak-ng', ['-v', 'cs', '-s', '142', '-p', '35', '-a', '170', '-w', filePath, text], {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return assertGeneratedAudio(filePath, 'espeak-ng');
}

export async function ttsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/tts/status', async () => {
    const edge = await findEdgeTtsCandidate();
    const edgeAvailable = Boolean(edge.candidate);
    const espeakAvailable = await hasCommand('espeak-ng', ['--version']);

    return {
      ok: edgeAvailable || espeakAvailable,
      preferredEngine: edgeAvailable ? 'edge-tts' : espeakAvailable ? 'espeak-ng' : null,
      renderHint: {
        edgeTtsPython: env.EDGE_TTS_PYTHON || null,
        expectedRenderValue: '/usr/bin/python3',
        note: 'Na Renderu musí být v Docker runtime nainstalovaný python3 a edge-tts. Aplikace neukládá audio trvale, generuje ho do /tmp.',
      },
      edgeTts: {
        ok: edgeAvailable,
        command: edge.candidate?.label ?? null,
        checks: edge.checks,
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
        reply.header('X-TTS-Bytes', String(result.bytes));
        return reply.send(createReadStream(mp3Path).on('close', () => {
          void rm(mp3Path, { force: true });
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'edge-tts neural voice is unavailable';
        request.log.warn({ error, message }, 'Neural Czech TTS failed');
        await rm(mp3Path, { force: true });
        if (requestedEngine === 'neural' || requestedEngine === 'edge-tts') {
          return reply.code(503).send({
            error: 'neural_tts_unavailable',
            message,
            hint: 'Otevřete /api/tts/status a zkontrolujte edgeTts.checks. Na Renderu má být EDGE_TTS_PYTHON=/usr/bin/python3.',
          });
        }
      }
    }

    try {
      const bytes = await synthesizeWithEspeak(text, wavPath);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-TTS-Engine', 'espeak-ng');
      reply.header('X-TTS-Voice', 'cs');
      reply.header('X-TTS-Bytes', String(bytes));
      return reply.send(createReadStream(wavPath).on('close', () => {
        void rm(wavPath, { force: true });
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No Czech TTS engine is available.';
      request.log.warn({ error, message }, 'Fallback Czech TTS failed');
      await rm(wavPath, { force: true });
      return reply.code(503).send({
        error: 'tts_unavailable',
        message,
        hint: 'Neuralní hlas vyžaduje edge-tts. Na Renderu zkontrolujte Docker build a EDGE_TTS_PYTHON=/usr/bin/python3.',
      });
    }
  });
}
