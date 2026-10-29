import { createHash } from 'node:crypto';
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  fixtureIdentityProvider,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { MAX_BUNDLE_BYTES } from '../../src/photos/index.ts';
import type { PhotoBundleRequest, PhotoBundleResponse } from '../../src/photos/bundle.ts';
import { minimalJpeg, minimalPng } from './fixtures.ts';

const BASE_ORIGIN = 'http://wardboard.example';
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Person' };
const ADMIN: Identity = { login: 'admin@example.test', displayName: 'Admin Person' };
const ADMIN_LOGIN = ADMIN.login;

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

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected chunk');
}

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-bundle-http-'));
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
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
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
  const access = createAccess(db, () => new Date('2026-05-06T00:00:00.000Z'), () => 'bundle-access-id');
  return { server, dataDir, access };
}

async function startEditor(): Promise<{ server: RunningServer; dataDir: string; access: Access }> {
  const started = await startWith(EDITOR, ADMIN_LOGIN);
  const admin = userByLogin(started.access, ADMIN_LOGIN);
  expect(started.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  // Issue a request to resolve the invitation into an active editor user
  await call(started.server.port, 'GET', '/api/photos');
  return started;
}

async function startAdmin(): Promise<{ server: RunningServer; dataDir: string; access: Access }> {
  return startWith(ADMIN, ADMIN_LOGIN);
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
        path: '/api/photos/bundle',
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
    req.on('error', (err) => {
      if (settled) return;
      fail(err);
    });
    writeBody(req);
  });
}

function call(
  port: number,
  method: string,
  requestPath: string,
  headers?: Record<string, string>,
  body?: Uint8Array | string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? Buffer.from(body) : body;
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        agent: false,
        headers: {
          connection: 'close',
          ...(payload !== undefined ? { 'content-length': String(payload.byteLength) } : {}),
          ...headers,
        },
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
    if (payload === undefined) req.end();
    else req.end(payload);
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validBundle(): { json: string; pngStem: string; jpgStem: string } {
  const pngBytes = minimalPng();
  const jpgBytes = minimalJpeg();
  const pngStem = sha256Hex(pngBytes);
  const jpgStem = sha256Hex(jpgBytes);
  const pngFile = `${pngStem}.png`;
  const jpgFile = `${jpgStem}.jpg`;

  const payload = {
    manifest: {
      format: 'wardboard-photo-bundle',
      version: 1,
      layoutVersion: '2026.1',
      portraits: [
        { name: 'Alice Young', file: pngFile, duplicateName: false },
        { name: 'Bob Smith', file: jpgFile, duplicateName: true },
      ],
      missing: [
        { name: 'Charlie None', reason: 'none' },
        { name: 'Family Group', reason: 'household' },
      ],
      skippedHousehold: 1,
    },
    files: {
      [pngFile]: Buffer.from(pngBytes).toString('base64'),
      [jpgFile]: Buffer.from(jpgBytes).toString('base64'),
    },
  };

  return { json: JSON.stringify(payload), pngStem, jpgStem };
}

describe('POST /api/photos/bundle', () => {
  it('refuses unauthenticated and revoked requests on POST /api/photos/bundle', async () => {
    const unauthenticated = await startWith(null, ADMIN_LOGIN);
    const unauthResult = await call(
      unauthenticated.server.port,
      'POST',
      '/api/photos/bundle',
      { origin: BASE_ORIGIN, 'content-type': 'application/json' },
      validBundle().json,
    );
    expect(unauthResult.status).toBe(401);

    const started = await startEditor();
    const admin = userByLogin(started.access, ADMIN_LOGIN);
    const editor = userByLogin(started.access, EDITOR.login);
    expect(started.access.revokeUser(admin.id, editor.id).ok).toBe(true);

    const revokedResult = await call(
      started.server.port,
      'POST',
      '/api/photos/bundle',
      { origin: BASE_ORIGIN, 'content-type': 'application/json' },
      validBundle().json,
    );
    expect(revokedResult.status).toBe(403);
  });

  it('allows both Editor and Admin to upload a valid photo bundle', async () => {
    // Editor
    const editorStarted = await startEditor();
    const bundle = validBundle();
    const editorResult = await call(
      editorStarted.server.port,
      'POST',
      '/api/photos/bundle',
      { origin: BASE_ORIGIN, 'content-type': 'application/json' },
      bundle.json,
    );
    expect(editorResult.status).toBe(200);
    const editorBody = JSON.parse(editorResult.body.toString('utf8')) as PhotoBundleResponse;
    expect(editorBody.portraits).toHaveLength(2);
    const [firstPortrait, secondPortrait] = editorBody.portraits;
    expect(firstPortrait?.name).toBe('Alice Young');
    expect(firstPortrait?.photoRef).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(secondPortrait?.name).toBe('Bob Smith');
    expect(secondPortrait?.photoRef).toMatch(/^[0-9a-f]{64}\.jpg$/);
    expect(editorBody.skippedHousehold).toBe(1);

    const editorPhotos = await storedNames(editorStarted.dataDir);
    expect(editorPhotos).toHaveLength(2);

    // Admin
    const adminStarted = await startAdmin();
    const adminResult = await call(
      adminStarted.server.port,
      'POST',
      '/api/photos/bundle',
      { origin: BASE_ORIGIN, 'content-type': 'application/json' },
      bundle.json,
    );
    expect(adminResult.status).toBe(200);
    const adminBody = JSON.parse(adminResult.body.toString('utf8')) as PhotoBundleResponse;
    expect(adminBody.portraits).toHaveLength(2);
    const adminPhotos = await storedNames(adminStarted.dataDir);
    expect(adminPhotos).toHaveLength(2);
  });

  it('refuses missing or foreign Origin on POST /api/photos/bundle', async () => {
    const started = await startEditor();
    const bundle = validBundle();

    const missingOrigin = await call(
      started.server.port,
      'POST',
      '/api/photos/bundle',
      { 'content-type': 'application/json' },
      bundle.json,
    );
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.headers['cache-control']).toBe('no-store');

    const foreignOrigin = await call(
      started.server.port,
      'POST',
      '/api/photos/bundle',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
      bundle.json,
    );
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.headers['cache-control']).toBe('no-store');
  });

  it('refuses non-POST methods on /api/photos/bundle with 405', async () => {
    const started = await startEditor();
    const result = await call(started.server.port, 'GET', '/api/photos/bundle', { origin: BASE_ORIGIN });
    expect(result.status).toBe(405);
    expect(result.headers['allow']).toBe('POST');
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({ error: 'method_not_allowed' });
  });

  it('refuses an oversized bundle with 413', async () => {
    const started = await startEditor();

    // 1. Declared Content-Length over MAX_BUNDLE_BYTES
    const declared = await openPost(
      started.server.port,
      {
        'content-type': 'application/json',
        'content-length': String(MAX_BUNDLE_BYTES + 1),
        origin: BASE_ORIGIN,
        connection: 'close',
      },
      (req) => {
        req.flushHeaders();
      },
    );
    expect(declared.status).toBe(413);
    expect(declared.body.toString('utf8')).toBe('{"error":"too_large"}');
    expect(declared.headers['connection']).toBe('close');
    expect(await storedNames(started.dataDir)).toEqual([]);

    // 2. Streamed body exceeding MAX_BUNDLE_BYTES
    const payload = Buffer.alloc(MAX_BUNDLE_BYTES + 1, 0x61);
    let requestEnded = false;
    const chunked = await openPost(
      started.server.port,
      {
        'content-type': 'application/json',
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
    expect(chunked.headers['connection']).toBe('close');
    expect(await storedNames(started.dataDir)).toEqual([]);
  });

  it('rejects invalid manifest, hash mismatch, or corrupt image without storing any photo', async () => {
    const started = await startEditor();
    const base = validBundle();

    const baseReq = JSON.parse(base.json) as PhotoBundleRequest;

    // 1. Wrong format
    const badFormat = {
      ...baseReq,
      manifest: { ...baseReq.manifest, format: 'wrong-format' },
    };
    let res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(badFormat));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ error: 'invalid_bundle' });
    expect(await storedNames(started.dataDir)).toHaveLength(0);

    // 2. Wrong version
    const badVersion = {
      ...baseReq,
      manifest: { ...baseReq.manifest, version: 2 },
    };
    res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(badVersion));
    expect(res.status).toBe(400);
    expect(await storedNames(started.dataDir)).toHaveLength(0);

    // 3. Path traversal filename
    const pathTraversal = {
      ...baseReq,
      manifest: {
        ...baseReq.manifest,
        portraits: baseReq.manifest.portraits.map((p, idx) =>
          idx === 0 ? { ...p, file: '../etc/passwd.png' } : p,
        ),
      },
    };
    res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(pathTraversal));
    expect(res.status).toBe(400);
    expect(await storedNames(started.dataDir)).toHaveLength(0);

    // 4. SHA-256 stem mismatch
    const goodFile = Object.keys(baseReq.files)[0] ?? '';
    const corruptStem = '0'.repeat(64);
    const corruptFile = `${corruptStem}.png`;
    const hashMismatch: PhotoBundleRequest = {
      manifest: {
        ...baseReq.manifest,
        portraits: baseReq.manifest.portraits.map((p, idx) =>
          idx === 0 ? { ...p, file: corruptFile } : p,
        ),
      },
      files: {
        [corruptFile]: baseReq.files[goodFile] ?? '',
      },
    };
    res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(hashMismatch));
    expect(res.status).toBe(400);
    expect(await storedNames(started.dataDir)).toHaveLength(0);

    // 5. Missing file entry in `files`
    const missingFile: PhotoBundleRequest = {
      manifest: baseReq.manifest,
      files: {},
    };
    res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(missingFile));
    expect(res.status).toBe(400);
    expect(await storedNames(started.dataDir)).toHaveLength(0);

    // 6. Corrupt image bytes (hash matches stem, but sanitize fails)
    const corruptBytes = Buffer.from('not a valid png or jpeg image');
    const corruptHashStem = sha256Hex(corruptBytes);
    const corruptImgFile = `${corruptHashStem}.png`;
    const corruptPayload = {
      manifest: {
        format: 'wardboard-photo-bundle',
        version: 1,
        layoutVersion: '2026.1',
        portraits: [{ name: 'Corrupt One', file: corruptImgFile, duplicateName: false }],
        missing: [],
        skippedHousehold: 0,
      },
      files: {
        [corruptImgFile]: corruptBytes.toString('base64'),
      },
    };
    res = await call(started.server.port, 'POST', '/api/photos/bundle', { origin: BASE_ORIGIN }, JSON.stringify(corruptPayload));
    expect(res.status).toBe(400);
    expect(await storedNames(started.dataDir)).toHaveLength(0);
  });
});
