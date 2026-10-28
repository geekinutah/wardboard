import { randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Role } from '../access/index.ts';
import { restoreBackup, createBackup } from './backup.ts';

export type BackupHttpInput = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  url: string;
  db: DatabaseSync;
  dataDir: string;
  clock: () => Date;
  maxBackupBytes: number;
  role: Role;
  appOrigin: string;
  listenOrigin: string;
  onRestored: () => void;
};

function sendJson(res: ServerResponse, status: number, body: string, extra?: Readonly<Record<string, string>>): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(extra ?? {}),
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function sendTooLarge(req: IncomingMessage, res: ServerResponse): void {
  const payload = Buffer.from('{"error":"too_large"}');
  res.writeHead(413, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
    connection: 'close',
  });
  res.end(payload, () => {
    req.on('error', () => undefined);
    req.destroy();
  });
}

function originAllowed(header: string | string[] | undefined, appOrigin: string, listenOrigin: string): boolean {
  if (typeof header !== 'string' || header.length === 0) return false;
  return header === appOrigin || header === listenOrigin;
}

function overDeclaredLength(value: string | string[] | undefined, max: number): boolean {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return false;
  if (value.length > 15) return true;
  return Number(value) > max;
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected upload chunk');
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (bytesWritten === 0) throw new Error('short write');
    offset += bytesWritten;
  }
}

async function writeLimited(req: IncomingMessage, handle: FileHandle, max: number): Promise<'ok' | 'too_large'> {
  const stream: AsyncIterable<unknown> = req;
  let received = 0;
  for await (const chunk of stream) {
    const buf = asBuffer(chunk);
    received += buf.byteLength;
    if (received > max) {
      req.pause();
      return 'too_large';
    }
    await writeAll(handle, buf);
  }
  return 'ok';
}

function restoreMode(url: string): 'dry-run' | 'apply' | null {
  const queryAt = url.indexOf('?');
  if (queryAt === -1) return null;
  const mode = new URLSearchParams(url.slice(queryAt + 1)).get('mode');
  if (mode === 'dry-run' || mode === 'apply') return mode;
  return null;
}

function backupFilename(now: Date): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `wardboard-backup-${date}-${time}.tar`;
}

async function handleDownload(input: BackupHttpInput): Promise<void> {
  if (input.method !== 'GET') {
    sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'GET' });
    return;
  }
  const now = input.clock();
  const archive = await createBackup(input.dataDir, () => now);
  const filename = backupFilename(now);
  input.res.writeHead(200, {
    'content-type': 'application/x-tar',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'content-length': String(archive.byteLength),
    'x-content-type-options': 'nosniff',
  });
  input.res.end(archive);
}

async function handleRestore(input: BackupHttpInput): Promise<void> {
  if (input.method !== 'POST') {
    sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'POST' });
    return;
  }
  if (!originAllowed(input.req.headers.origin, input.appOrigin, input.listenOrigin)) {
    sendJson(input.res, 403, '{"error":"forbidden"}');
    return;
  }
  const mode = restoreMode(input.url);
  if (mode === null) {
    sendJson(input.res, 400, '{"error":"bad_request"}');
    return;
  }
  if (overDeclaredLength(input.req.headers['content-length'], input.maxBackupBytes)) {
    sendTooLarge(input.req, input.res);
    return;
  }

  const uploadPath = path.join(input.dataDir, `.restore-${randomBytes(16).toString('hex')}.upload`);
  let keepUpload = true;
  try {
    const handle = await open(uploadPath, 'wx');
    let limited: 'ok' | 'too_large';
    try {
      limited = await writeLimited(input.req, handle, input.maxBackupBytes);
    } finally {
      await handle.close();
    }
    if (limited === 'too_large') {
      await rm(uploadPath, { force: true });
      keepUpload = false;
      sendTooLarge(input.req, input.res);
      return;
    }

    const bytes = await readFile(uploadPath);
    await rm(uploadPath, { force: true });
    keepUpload = false;
    const result = await restoreBackup(input.db, input.dataDir, bytes, { mode });
    if (!result.ok) {
      sendJson(input.res, 422, JSON.stringify({ error: result.error }));
      return;
    }
    if (mode === 'apply') input.onRestored();
    const body =
      mode === 'dry-run'
        ? JSON.stringify({ summary: result.summary })
        : JSON.stringify({ restored: true, summary: result.summary });
    sendJson(input.res, 200, body);
  } finally {
    if (keepUpload) await rm(uploadPath, { force: true });
  }
}

export async function handleBackupRequest(input: BackupHttpInput): Promise<void> {
  if (input.role !== 'admin') {
    sendJson(input.res, 403, '{"error":"forbidden"}');
    return;
  }
  if (input.pathname === '/api/admin/backup') {
    await handleDownload(input);
    return;
  }
  await handleRestore(input);
}
