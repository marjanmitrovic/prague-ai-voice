import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CallSession } from '../calls/call-session.js';

const logsDir = path.resolve(process.cwd(), 'logs');

export async function writeCallSessionLog(session: CallSession): Promise<string> {
  await mkdir(logsDir, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${session.callSid ?? session.id}.json`;
  const fullPath = path.join(logsDir, fileName);
  await writeFile(fullPath, JSON.stringify(session.toLogRecord(), null, 2), 'utf8');
  return fullPath;
}
