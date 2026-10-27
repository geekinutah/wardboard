import { createHash } from 'node:crypto';
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  MAX_PHOTO_BYTES as EXPORTED_LIMIT,
  fixtureIdentityProvider,
  sanitizePhoto,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { includesAscii, jpegOfSize, metadataJpeg, metadataPng, minimalJpeg } from './fixtures.ts';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const BASE_ORIGIN = 'http://wardboard.example';
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Person' };
const ADMIN_LOGIN = 'admin@example.test';

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type HttpResult = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected socket chunk');
}

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-photo-http-'));
  tempDirs.push(dir);
  return dir;
}

function userByLogin(access: Access, login: string): User {
  const user = access.listUsers().find((candidate) => candidate.login === login);
  if (user === undefined) throw new Error(`missing user ${login}`);
  return user;
}

async function storedNames(dataDir: string): Promise<string[]> {
  try {
    return await readdir(path.join(dataDir, 'photos'));
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return [];
    throw error;
  }
}

async function startWith(
  identity: Identity | null,
  initialAdminLogin?: string,
): Promise<{ server: RunningServer; dataDir: string; access: Access }> {
  const dataDir = path.join(await makeTemp(), 'data');
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    ...(initialAdminLogin !== undefined ? { initialAdminLogin } : {}),
  };
  const server = await startServer(config, { identityProvider: fixtureIdentityProvider(identity) });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const access = createAccess(db, () => new Date('2026-05-06T00:00:00.000Z'), () => 'photo-access-id');
  return { server, dataDir, access };
}

async function startEditor(): Promise<{ server: RunningServer; dataDir: string; access: Access }> {
  const started = await startWith(EDITOR, ADMIN_LOGIN);
  const admin = userByLogin(started.access, ADMIN_LOGIN);
  expect(started.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  return started;
}

function call(
  port: number,
  method: string,
  requestPath: string,
  headers?: Record<string, string>,
  body?: Uint8Array,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: unknown) => {
          chunks.push(bufferChunk(chunk));
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body === undefined) req.end();
    else req.end(body);
  });
}

function exchange(port: number, payload: Buffer): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('socket failed'));
    };
    const finish = (): void => {
      if (settled) return;
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        fail(new Error('response did not finish'));
        return;
      }
      const head = buffer.toString('latin1', 0, headerEnd);
      const lines = head.split('\r\n');
      const statusLine = lines[0] ?? '';
      const match = /^HTTP\/1\.[01] (\d{3})\b/.exec(statusLine);
      const statusText = match?.[1];
      if (statusText === undefined) {
        fail(new Error(`bad status line ${statusLine}`));
        return;
      }
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      const lengthHeader = headers['content-length'];
      const length = lengthHeader !== undefined && /^[0-9]+$/.test(lengthHeader) ? Number(lengthHeader) : undefined;
      const bodyStart = headerEnd + 4;
      if (length === undefined || buffer.length < bodyStart + length) {
        fail(new Error('response body was truncated'));
        return;
      }
      settled = true;
      resolve({
        status: Number(statusText),
        headers,
        body: buffer.toString('utf8', bodyStart, bodyStart + length),
      });
      socket.end();
    };
    socket.on('data', (chunk: unknown) => {
      chunks.push(bufferChunk(chunk));
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const head = buffer.toString('latin1', 0, headerEnd);
      const match = /content-length:\s*(\d+)/i.exec(head);
      const length = match?.[1];
      if (length !== undefined && buffer.length >= headerEnd + 4 + Number(length)) finish();
    });
    socket.on('end', finish);
    socket.on('error', fail);
    socket.write(payload);
  });
}

function openPost(
  port: number,
  headers: Record<string, string>,
  writeBody: (req: ClientRequest) => void,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (result: HttpResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('upload failed'));
    };
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/photos',
        method: 'POST',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: unknown) => {
          chunks.push(bufferChunk(chunk));
        });
        res.on('end', () => {
          succeed({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', fail);
      },
    );
    req.on('error', fail);
    writeBody(req);
  });
}

describe('photo routes', () => {
  it('unauthenticated POST and GET → 401', async () => {
    const { server, dataDir } = await startWith(null);
    const headers = { 'content-type': 'image/jpeg', origin: BASE_ORIGIN };

    const post = await call(server.port, 'POST', '/api/photos', headers, minimalJpeg());
    const get = await call(server.port, 'GET', `/api/photos/${'ab'.repeat(32)}.jpg`);

    expect(post.status).toBe(401);
    expect(post.body.toString('utf8')).toBe('{"error":"unauthenticated"}');
    expect(headerValue(post.headers, 'cache-control')).toBe('no-store');
    expect(get.status).toBe(401);
    expect(get.body.toString('utf8')).toBe('{"error":"unauthenticated"}');
    expect(headerValue(get.headers, 'cache-control')).toBe('no-store');
    expect(await storedNames(dataDir)).toEqual([]);
  });

  it('revoked user POST and GET → 403', async () => {
    const { server, dataDir, access } = await startEditor();
    const probe = await call(server.port, 'GET', '/api/nope');
    expect(probe.status).toBe(404);
    const admin = userByLogin(access, ADMIN_LOGIN);
    const editor = userByLogin(access, EDITOR.login);
    expect(editor.role).toBe('editor');
    expect(access.revokeUser(admin.id, editor.id).ok).toBe(true);

    const headers = { 'content-type': 'image/jpeg', origin: BASE_ORIGIN };
    const post = await call(server.port, 'POST', '/api/photos', headers, minimalJpeg());
    const get = await call(server.port, 'GET', `/api/photos/${'ab'.repeat(32)}.jpg`);

    expect(post.status).toBe(403);
    expect(post.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(headerValue(post.headers, 'cache-control')).toBe('no-store');
    expect(get.status).toBe(403);
    expect(get.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(headerValue(get.headers, 'cache-control')).toBe('no-store');
    expect(await storedNames(dataDir)).toEqual([]);
  });

  it('Editor uploads, then reads back the sanitized bytes with the required headers', async () => {
    const { server, access } = await startEditor();
    const jpeg = metadataJpeg();
    const png = metadataPng();
    const jpegResponse = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'Image/JPEG; charset=binary',
      origin: BASE_ORIGIN,
    }, jpeg.original);

    expect(jpegResponse.status).toBe(201);
    expect(headerValue(jpegResponse.headers, 'content-type')).toBe('application/json');
    const jpegSanitized = sanitizePhoto(jpeg.original, 'Image/JPEG; charset=binary');
    expect(jpegSanitized.ok).toBe(true);
    if (!jpegSanitized.ok) return;
    const jpegHash = createHash('sha256').update(jpegSanitized.bytes).digest('hex');
    expect(JSON.parse(jpegResponse.body.toString('utf8'))).toEqual({ photoRef: `${jpegHash}.jpg` });

    const jpegRead = await call(server.port, 'GET', `/api/photos/${jpegHash}.jpg`);
    expect(jpegRead.status).toBe(200);
    expect(headerValue(jpegRead.headers, 'content-type')).toBe('image/jpeg');
    expect(headerValue(jpegRead.headers, 'x-content-type-options')).toBe('nosniff');
    expect(headerValue(jpegRead.headers, 'cross-origin-resource-policy')).toBe('same-origin');
    expect(headerValue(jpegRead.headers, 'cache-control')).toBe('private, max-age=31536000, immutable');
    expect(jpegRead.body.equals(Buffer.from(jpegSanitized.bytes))).toBe(true);
    expect(includesAscii(jpegRead.body, 'CANARY-GPS-40.7N')).toBe(false);

    const pngResponse = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/png',
      origin: server.url,
    }, png.original);
    expect(pngResponse.status).toBe(201);
    const pngSanitized = sanitizePhoto(png.original, 'image/png');
    expect(pngSanitized.ok).toBe(true);
    if (!pngSanitized.ok) return;
    const pngHash = createHash('sha256').update(pngSanitized.bytes).digest('hex');
    expect(JSON.parse(pngResponse.body.toString('utf8'))).toEqual({ photoRef: `${pngHash}.png` });
    const pngRead = await call(server.port, 'GET', `/api/photos/${pngHash}.png`);
    expect(pngRead.status).toBe(200);
    expect(headerValue(pngRead.headers, 'content-type')).toBe('image/png');
    expect(headerValue(pngRead.headers, 'x-content-type-options')).toBe('nosniff');
    expect(headerValue(pngRead.headers, 'cross-origin-resource-policy')).toBe('same-origin');
    expect(headerValue(pngRead.headers, 'cache-control')).toBe('private, max-age=31536000, immutable');
    expect(pngRead.body.equals(Buffer.from(pngSanitized.bytes))).toBe(true);
    expect(includesAscii(pngRead.body, 'CANARY-GPS-40.7N')).toBe(false);

    expect(userByLogin(access, EDITOR.login)).toMatchObject({ role: 'editor', revokedAt: null });
  });

  it('POST with foreign or missing Origin → 403 and nothing stored', async () => {
    const { server, dataDir } = await startEditor();
    const jpeg = minimalJpeg();
    const foreign = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/jpeg',
      origin: 'http://evil.example',
    }, jpeg);
    const missing = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/jpeg',
    }, jpeg);

    expect(foreign.status).toBe(403);
    expect(foreign.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(missing.status).toBe(403);
    expect(missing.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(await storedNames(dataDir)).toEqual([]);
  });

  it('POST over MAX_PHOTO_BYTES → 413 and nothing stored', async () => {
    expect(EXPORTED_LIMIT).toBe(MAX_PHOTO_BYTES);
    const { server, dataDir } = await startEditor();
    const declared = await openPost(
      server.port,
      {
        'content-type': 'image/jpeg',
        'content-length': String(MAX_PHOTO_BYTES + 1),
        origin: BASE_ORIGIN,
        connection: 'close',
      },
      (req) => {
        req.flushHeaders();
      },
    );
    expect(declared.status).toBe(413);
    expect(declared.body.toString('utf8')).toBe('{"error":"too_large"}');
    expect(headerValue(declared.headers, 'connection')).toBe('close');
    expect(await storedNames(dataDir)).toEqual([]);

    const payload = Buffer.alloc(MAX_PHOTO_BYTES + 1, 0x61);
    let requestEnded = false;
    const chunked = await openPost(
      server.port,
      {
        'content-type': 'image/jpeg',
        origin: BASE_ORIGIN,
      },
      (req) => {
        req.write(payload);
        req.on('finish', () => {
          requestEnded = true;
        });
      },
    );
    expect(requestEnded).toBe(false);
    expect(chunked.status).toBe(413);
    expect(chunked.body.toString('utf8')).toBe('{"error":"too_large"}');
    expect(headerValue(chunked.headers, 'connection')).toBe('close');
    expect(await storedNames(dataDir)).toEqual([]);

    const health = await call(server.port, 'GET', '/api/health');
    expect(health.status).toBe(200);
  });

  it('accepts exactly MAX_PHOTO_BYTES', async () => {
    const { server } = await startEditor();
    const body = jpegOfSize(MAX_PHOTO_BYTES);
    const response = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/jpeg',
      origin: BASE_ORIGIN,
    }, body);

    expect(response.status).toBe(201);
    const payload: unknown = JSON.parse(response.body.toString('utf8'));
    expect(payload).toMatchObject({ photoRef: expect.stringMatching(/^[0-9a-f]{64}\.jpg$/) as string });
    if (typeof payload !== 'object' || payload === null || !('photoRef' in payload)) return;
    const ref = payload.photoRef;
    if (typeof ref !== 'string') return;
    const read = await call(server.port, 'GET', `/api/photos/${ref}`);
    expect(read.status).toBe(200);
    expect(read.body.equals(Buffer.from(body))).toBe(true);
  });

  it('empty body is invalid_image', async () => {
    const { server, dataDir } = await startEditor();
    const response = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/jpeg',
      origin: BASE_ORIGIN,
      'content-length': '0',
    });

    expect(response.status).toBe(400);
    expect(response.body.toString('utf8')).toBe('{"error":"invalid_image"}');
    expect(await storedNames(dataDir)).toEqual([]);
  });

  it('POST unsupported type → 415; malformed image → 400', async () => {
    const { server, dataDir } = await startEditor();
    const headers = { origin: BASE_ORIGIN };
    const gif = await call(server.port, 'POST', '/api/photos', {
      ...headers,
      'content-type': 'image/gif',
    }, minimalJpeg());
    const svg = await call(server.port, 'POST', '/api/photos', {
      ...headers,
      'content-type': 'image/svg+xml',
    }, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    const html = await call(server.port, 'POST', '/api/photos', {
      ...headers,
      'content-type': 'text/html',
    }, Buffer.from('<html></html>'));
    const missingType = await call(server.port, 'POST', '/api/photos', headers, minimalJpeg());
    const truncated = await call(server.port, 'POST', '/api/photos', {
      ...headers,
      'content-type': 'image/jpeg',
    }, Uint8Array.of(0xff, 0xd8, 0xff));
    const mismatch = await call(server.port, 'POST', '/api/photos', {
      ...headers,
      'content-type': 'image/jpeg',
    }, metadataPng().original);

    expect(gif.status).toBe(415);
    expect(gif.body.toString('utf8')).toBe('{"error":"unsupported_type"}');
    expect(svg.status).toBe(415);
    expect(html.status).toBe(415);
    expect(missingType.status).toBe(415);
    expect(truncated.status).toBe(400);
    expect(truncated.body.toString('utf8')).toBe('{"error":"invalid_image"}');
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.toString('utf8')).toBe('{"error":"invalid_image"}');
    expect(await storedNames(dataDir)).toEqual([]);
  });

  it('GET unknown or malformed ref → 404; HEAD returns headers without body', async () => {
    const { server } = await startEditor();
    const jpeg = minimalJpeg();
    const uploaded = await call(server.port, 'POST', '/api/photos', {
      'content-type': 'image/jpeg',
      origin: BASE_ORIGIN,
    }, jpeg);
    expect(uploaded.status).toBe(201);
    const payload: unknown = JSON.parse(uploaded.body.toString('utf8'));
    if (typeof payload !== 'object' || payload === null || !('photoRef' in payload) || typeof payload.photoRef !== 'string') {
      throw new Error('upload did not return photoRef');
    }
    const ref = payload.photoRef;
    const hex = 'ab'.repeat(32);
    const unknown = await call(server.port, 'GET', `/api/photos/${hex}.png`);
    const uppercase = await call(server.port, 'GET', `/api/photos/${'A'.repeat(64)}.jpg`);
    const gif = await call(server.port, 'GET', `/api/photos/${hex}.gif`);
    const traversal = await exchange(
      server.port,
      Buffer.from(`GET /api/photos/../x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`, 'ascii'),
    );

    expect(unknown.status).toBe(404);
    expect(unknown.body.toString('utf8')).toBe('{"error":"not_found"}');
    expect(uppercase.status).toBe(404);
    expect(uppercase.body.toString('utf8')).toBe('{"error":"not_found"}');
    expect(gif.status).toBe(404);
    expect(traversal.status).toBe(404);
    expect(traversal.body).toBe('{"error":"not_found"}');

    const headKnown = await call(server.port, 'HEAD', `/api/photos/${ref}`);
    expect(headKnown.status).toBe(200);
    expect(headKnown.body).toEqual(Buffer.alloc(0));
    expect(headerValue(headKnown.headers, 'content-type')).toBe('image/jpeg');
    expect(headerValue(headKnown.headers, 'x-content-type-options')).toBe('nosniff');
    expect(headerValue(headKnown.headers, 'cross-origin-resource-policy')).toBe('same-origin');
    expect(headerValue(headKnown.headers, 'cache-control')).toBe('private, max-age=31536000, immutable');
    expect(headerValue(headKnown.headers, 'content-length')).toBe(String(jpeg.length));

    const headUnknown = await call(server.port, 'HEAD', `/api/photos/${hex}.jpg`);
    expect(headUnknown.status).toBe(404);
    expect(headUnknown.body).toEqual(Buffer.alloc(0));
    expect(headerValue(headUnknown.headers, 'content-type')).toBe('application/json');
  });

  it('PUT/DELETE on photo paths → 405 with allow', async () => {
    const { server } = await startEditor();
    const ref = `${'ab'.repeat(32)}.jpg`;
    const putCollection = await call(server.port, 'PUT', '/api/photos');
    const deleteCollection = await call(server.port, 'DELETE', '/api/photos');
    const getCollection = await call(server.port, 'GET', '/api/photos');
    const putItem = await call(server.port, 'PUT', `/api/photos/${ref}`);
    const deleteItem = await call(server.port, 'DELETE', `/api/photos/${ref}`);
    const postItem = await call(server.port, 'POST', `/api/photos/${ref}`, { origin: BASE_ORIGIN });

    expect(putCollection.status).toBe(405);
    expect(headerValue(putCollection.headers, 'allow')).toBe('POST');
    expect(deleteCollection.status).toBe(405);
    expect(headerValue(deleteCollection.headers, 'allow')).toBe('POST');
    expect(getCollection.status).toBe(405);
    expect(headerValue(getCollection.headers, 'allow')).toBe('POST');
    expect(putItem.status).toBe(405);
    expect(headerValue(putItem.headers, 'allow')).toBe('GET, HEAD');
    expect(deleteItem.status).toBe(405);
    expect(headerValue(deleteItem.headers, 'allow')).toBe('GET, HEAD');
    expect(postItem.status).toBe(405);
    expect(headerValue(postItem.headers, 'allow')).toBe('GET, HEAD');
  });
});
