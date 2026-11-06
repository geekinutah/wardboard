import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { createBackup, readTar } from '../../src/backup/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  fixtureIdentityProvider,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { minimalJpeg } from '../photos/fixtures.ts';

const CLOCK_ISO = '2026-08-01T00:00:00.000Z';
const BASE_ORIGIN = 'http://wardboard.example';
const FOREIGN_ORIGIN = 'http://evil.example';
const COLLECTION = '/api/admin/photo-collection';
const CONTINUE = '/api/admin/photo-collection/continue';
const CANCEL = '/api/admin/photo-collection/cancel';
const PORTRAIT_NAME = 'Zephyr Quilt';
const GIT_MESSAGE = 'Choose a staging folder outside any Git repository.';
const ADMIN: Identity = { login: 'admin@example.test', displayName: 'Admin Person' };
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Person' };
const STRANGER: Identity = { login: 'stranger@example.test', displayName: 'Stranger Person' };

const directoryConfig = {
  layoutVersion: 'directory-v2',
  startUrl: 'https://directory.example.test/',
  selectors: {
    householdList: 'a.households',
    householdLink: 'a.household',
    householdName: 'h1',
    householdImage: 'img.household',
    memberEntry: 'div.member',
    memberName: 'a.member',
    memberPortrait: 'img.member',
    signedOut: 'form.signin',
  },
  timeouts: { navigationMs: 30_000, elementMs: 10_000 },
  retries: { image: 2 },
};

type CollectResult = {
  status: 'done' | 'cancelled' | 'unsupported_layout' | 'refused' | 'failed';
  exitCode: 0 | 1 | 2;
  message: string;
};

type CollectOptions = {
  stagingDir: string;
  config: typeof directoryConfig;
  mode: 'new' | 'resume';
  browser: { headless: boolean };
  waitForSignIn: (message: string) => Promise<void>;
  log: (line: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
};

type Collector = {
  collect: (options: CollectOptions) => Promise<CollectResult>;
  config: typeof directoryConfig;
};

type Started = { server: RunningServer; dataDir: string; access: Access };

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: Buffer };

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

function clock(): Date {
  return new Date(CLOCK_ISO);
}

function cancelledResult(): CollectResult {
  return { status: 'cancelled', exitCode: 1, message: 'cancelled' };
}

function doneResult(): CollectResult {
  return { status: 'done', exitCode: 0, message: 'done' };
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected chunk');
}

function portraitFileName(): string {
  return `${createHash('sha256').update(minimalJpeg()).digest('hex')}.jpg`;
}

function stagingPath(dataDir: string): string {
  return path.join(dataDir, 'collector-staging');
}

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-photo-collection-'));
  tempDirs.push(dir);
  return dir;
}

function userByLogin(access: Access, login: string): User {
  const user = access.listUsers().find((candidate) => candidate.login === login);
  if (user === undefined) throw new Error(`missing user ${login}`);
  return user;
}

async function photoNames(dataDir: string): Promise<string[]> {
  try {
    return await readdir(path.join(dataDir, 'photos'));
  } catch (error: unknown) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

async function expectMissing(target: string): Promise<void> {
  await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function writeBundle(
  stagingDir: string,
  name: string,
  duplicateName: boolean,
  skippedHousehold: number,
): Promise<string> {
  const bytes = minimalJpeg();
  const file = `${createHash('sha256').update(bytes).digest('hex')}.jpg`;
  const bundleDir = path.join(stagingDir, 'wardboard-collector', 'bundle');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, file), bytes);
  const manifest = {
    format: 'wardboard-photo-bundle',
    version: 1,
    layoutVersion: 'directory-v2',
    portraits: [{ name, file, duplicateName }],
    missing: [],
    skippedHousehold,
  };
  await writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest));
  return file;
}

function call(
  port: number,
  method: string,
  requestPath: string,
  headers?: Record<string, string>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: requestPath, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: unknown) => {
          chunks.push(bufferChunk(chunk));
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function expectJson(result: HttpResult, status: number, body: unknown): void {
  expect(result.status).toBe(status);
  expect(result.headers['content-type']).toBe('application/json');
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(JSON.parse(result.body.toString('utf8'))).toEqual(body);
}

/** Polls GET. Each request yields; there is no timer. */
async function until(port: number, ready: (body: unknown) => boolean): Promise<unknown> {
  let last = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await call(port, 'GET', COLLECTION);
    last = result.body.toString('utf8');
    let body: unknown;
    try {
      body = JSON.parse(last) as unknown;
    } catch {
      body = undefined;
    }
    if (result.status === 200 && ready(body)) {
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      return body;
    }
  }
  throw new Error(`photo collection did not become ready: ${last}`);
}

function post(started: Started, requestPath: string, origin: string | null = BASE_ORIGIN): Promise<HttpResult> {
  const headers = origin === null ? undefined : { origin };
  return call(started.server.port, 'POST', requestPath, headers);
}

function get(started: Started): Promise<HttpResult> {
  return call(started.server.port, 'GET', COLLECTION);
}

async function startWith(
  identity: Identity | null,
  extras?: { collector?: Collector; initialAdminLogin?: string; log?: (line: string) => void },
): Promise<Started> {
  const root = await makeTemp();
  const dataDir = path.join(root, 'data');
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    ...(extras?.initialAdminLogin !== undefined ? { initialAdminLogin: extras.initialAdminLogin } : {}),
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(identity),
    clock,
    ...(extras?.collector === undefined ? {} : { photoCollector: extras.collector }),
    ...(extras?.log === undefined ? {} : { log: extras.log }),
  });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const access = createAccess(db, clock, () => 'photo-collection-access-id');
  return { server, dataDir, access };
}

function collector(collect: Collector['collect']): Collector {
  return { collect, config: directoryConfig };
}

function startAdmin(collect?: Collector['collect'], log?: (line: string) => void): Promise<Started> {
  return startWith(ADMIN, {
    initialAdminLogin: ADMIN.login,
    ...(collect === undefined ? {} : { collector: collector(collect) }),
    ...(log === undefined ? {} : { log }),
  });
}

async function startEditor(collect: Collector['collect']): Promise<Started> {
  const started = await startWith(EDITOR, {
    initialAdminLogin: ADMIN.login,
    collector: collector(collect),
  });
  const admin = userByLogin(started.access, ADMIN.login);
  expect(started.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  return started;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const db of databases.splice(0)) db.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('admin photo collection', () => {
  it('signed-out photo collection is unauthenticated', async () => {
    const started = await startWith(null, { initialAdminLogin: ADMIN.login });
    for (const requestPath of [COLLECTION, CONTINUE, CANCEL]) {
      expectJson(await call(started.server.port, 'GET', requestPath), 401, { error: 'unauthenticated' });
      expectJson(await call(started.server.port, 'POST', requestPath), 401, { error: 'unauthenticated' });
    }
  });

  it('an unknown login is forbidden', async () => {
    const started = await startWith(STRANGER, { initialAdminLogin: ADMIN.login });
    expectJson(await get(started), 403, { error: 'forbidden' });
  });

  it('an editor is forbidden on every photo-collection route', async () => {
    let calls = 0;
    const started = await startEditor(() => {
      calls += 1;
      return Promise.resolve(cancelledResult());
    });
    expectJson(await get(started), 403, { error: 'forbidden' });
    expectJson(await post(started, COLLECTION), 403, { error: 'forbidden' });
    expectJson(await post(started, CONTINUE), 403, { error: 'forbidden' });
    expectJson(await post(started, CANCEL), 403, { error: 'forbidden' });
    expect(calls).toBe(0);
  });

  it('admin POST without origin is forbidden', async () => {
    const started = await startAdmin(() => Promise.resolve(cancelledResult()));
    for (const requestPath of [COLLECTION, CONTINUE, CANCEL]) {
      expectJson(await post(started, requestPath, null), 403, { error: 'forbidden' });
      expectJson(await post(started, requestPath, FOREIGN_ORIGIN), 403, { error: 'forbidden' });
    }
    expectJson(await get(started), 200, { status: 'idle', progress: '' });
  });

  it('listen origin and app origin are both accepted', async () => {
    const hang = (options: CollectOptions): Promise<CollectResult> => {
      return options.waitForSignIn('Sign in.').then(() => cancelledResult());
    };
    const viaApp = await startAdmin(hang);
    expectJson(await post(viaApp, COLLECTION, BASE_ORIGIN), 200, { status: 'running' });
    const viaListen = await startAdmin(hang);
    expectJson(await post(viaListen, COLLECTION, viaListen.server.url), 200, { status: 'running' });
  });

  it('wrong method is rejected', async () => {
    const started = await startAdmin(() => Promise.resolve(cancelledResult()));
    const put = await call(started.server.port, 'PUT', COLLECTION, { origin: BASE_ORIGIN });
    expectJson(put, 405, { error: 'method_not_allowed' });
    expect(put.headers.allow).toBe('GET, POST');
    const getContinue = await call(started.server.port, 'GET', CONTINUE, { origin: BASE_ORIGIN });
    expectJson(getContinue, 405, { error: 'method_not_allowed' });
    expect(getContinue.headers.allow).toBe('POST');
  });

  it('no injected collector is unavailable and creates nothing', async () => {
    const started = await startAdmin();
    expectJson(await post(started, COLLECTION), 503, { error: 'collector_unavailable' });
    expectJson(await get(started), 200, { status: 'idle', progress: '' });
    await expectMissing(stagingPath(started.dataDir));
  });

  it('start calls collect once with a visible browser and the staging directory', async () => {
    const entered = defer();
    let calls = 0;
    let seen: CollectOptions | undefined;
    const started = await startAdmin(async (options) => {
      calls += 1;
      seen = options;
      entered.resolve();
      await options.waitForSignIn('Sign in.');
      return cancelledResult();
    });
    const response = await post(started, COLLECTION);
    expectJson(response, 200, { status: 'running' });
    await entered.promise;
    expect(calls).toBe(1);
    expect(seen?.mode).toBe('new');
    expect(seen?.browser.headless).toBe(false);
    expect(seen?.stagingDir).toBe(stagingPath(started.dataDir));
    expect(seen?.config).toEqual(directoryConfig);
    expect(seen?.now?.().toISOString()).toBe(CLOCK_ISO);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(seen?.signal?.aborted).toBe(false);
    const info = await lstat(stagingPath(started.dataDir));
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.isDirectory()).toBe(true);
    expect(info.mode & 0o777).toBe(0o700);
    expect(path.dirname(stagingPath(started.dataDir))).toBe(started.dataDir);
  });

  it('POST start returns while sign-in is still pending', async () => {
    let settled = false;
    const started = await startAdmin((options) => {
      const pending = options.waitForSignIn('Sign in.');
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      return pending.then(() => cancelledResult());
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('GET reports the progress line and then needs-sign-in', async () => {
    const progressLine = 'Households 1 of 2 · portraits 0 · missing 0';
    const signIn = 'Sign in to the directory in the browser window.';
    const logged = defer();
    const releaseLog = defer();
    const waiting = defer();
    const started = await startAdmin(async (options) => {
      options.log(progressLine);
      logged.resolve();
      await releaseLog.promise;
      const pending = options.waitForSignIn(signIn);
      waiting.resolve();
      await pending;
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await logged.promise;
    expectJson(await get(started), 200, { status: 'running', progress: progressLine });
    releaseLog.resolve();
    await waiting.promise;
    expectJson(await get(started), 200, { status: 'needs-sign-in', progress: signIn });
  });

  it('continue releases only the current wait', async () => {
    const firstEntered = defer();
    const releaseSecond = defer();
    const secondEntered = defer();
    let secondState: 'pending' | 'settled' = 'pending';
    const started = await startAdmin(async (options) => {
      const first = options.waitForSignIn('Sign in.');
      firstEntered.resolve();
      await first;
      await releaseSecond.promise;
      const second = options.waitForSignIn('Sign in again.');
      void second.then(
        () => {
          secondState = 'settled';
        },
        () => {
          secondState = 'settled';
        },
      );
      secondEntered.resolve();
      await second;
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await firstEntered.promise;
    expectJson(await post(started, CONTINUE), 200, { status: 'running' });
    expectJson(await post(started, CONTINUE), 409, { error: 'not_waiting' });
    releaseSecond.resolve();
    await secondEntered.promise;
    await Promise.resolve();
    expect(secondState).toBe('pending');
    expectJson(await get(started), 200, { status: 'needs-sign-in', progress: 'Sign in again.' });
    expectJson(await post(started, CONTINUE), 200, { status: 'running' });
  });

  it('a second start while waiting is refused', async () => {
    let calls = 0;
    const started = await startAdmin(async (options) => {
      calls += 1;
      await options.waitForSignIn('Sign in.');
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const waiting = await until(started.server.port, (body) => isRecord(body) && body.status === 'needs-sign-in');
    expect(waiting).toEqual({ status: 'needs-sign-in', progress: 'Sign in.' });
    expectJson(await post(started, COLLECTION), 409, { error: 'already_running' });
    expect(calls).toBe(1);
    expectJson(await get(started), 200, { status: 'needs-sign-in', progress: 'Sign in.' });
  });

  it('a finished bundle is sanitized into the review payload and staging is removed', async () => {
    const logs: string[] = [];
    const progressLine = 'Households 1 of 1 · portraits 1';
    const started = await startAdmin(async (options) => {
      options.log(progressLine);
      await writeBundle(options.stagingDir, PORTRAIT_NAME, true, 4);
      return doneResult();
    }, (line) => {
      logs.push(line);
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const file = portraitFileName();
    const body = await until(started.server.port, (value) => isRecord(value) && value.status === 'review');
    expect(body).toEqual({
      status: 'review',
      progress: progressLine,
      bundle: {
        portraits: [{ name: PORTRAIT_NAME, file, photoRef: file, duplicateName: true }],
        missing: [],
        skippedHousehold: 4,
      },
    });
    const image = await call(started.server.port, 'GET', `/api/photos/${file}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(image.body, Buffer.from(minimalJpeg()))).toBe(0);
    await expectMissing(stagingPath(started.dataDir));
    expect(await photoNames(started.dataDir)).toEqual([file]);
    expect(logs.join('\n')).not.toContain(PORTRAIT_NAME);
  });

  it('an invalid done bundle stores nothing', async () => {
    const started = await startAdmin(async (options) => {
      const bundleDir = path.join(options.stagingDir, 'wardboard-collector', 'bundle');
      await mkdir(bundleDir, { recursive: true });
      const file = `${'ab'.repeat(32)}.jpg`;
      await writeFile(path.join(bundleDir, file), Buffer.from('not-a-photo'));
      await writeFile(
        path.join(bundleDir, 'manifest.json'),
        JSON.stringify({
          format: 'wardboard-photo-bundle',
          version: 1,
          layoutVersion: 'directory-v2',
          portraits: [{ name: 'Bad Portrait', file, duplicateName: false }],
          missing: [],
          skippedHousehold: 0,
        }),
      );
      return doneResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const body = await until(started.server.port, (value) => isRecord(value) && value.status === 'failed');
    expect(body).toEqual({
      status: 'failed',
      progress: '',
      message: 'The collected bundle could not be read.',
    });
    expect(await photoNames(started.dataDir)).toEqual([]);
    await expectMissing(stagingPath(started.dataDir));
  });

  it('collector refusal becomes failed and keeps a sibling file', async () => {
    const started = await startAdmin(() => Promise.resolve({ status: 'refused', exitCode: 2, message: GIT_MESSAGE }));
    const sibling = path.join(started.dataDir, 'beside.txt');
    await writeFile(sibling, 'stay-beside-staging');
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const body = await until(started.server.port, (value) => isRecord(value) && value.status === 'failed');
    expect(body).toEqual({ status: 'failed', progress: '', message: GIT_MESSAGE });
    expect(await readFile(sibling, 'utf8')).toBe('stay-beside-staging');
    expect((await lstat(databasePath(started.dataDir))).isFile()).toBe(true);
    await expectMissing(stagingPath(started.dataDir));
  });

  it('cancel aborts the wait and deletes staging', async () => {
    let signal: AbortSignal | undefined;
    let waitRejected = false;
    const entered = defer();
    const started = await startAdmin(async (options) => {
      signal = options.signal;
      const waiting = options.waitForSignIn('Sign in.');
      entered.resolve();
      try {
        await waiting;
      } catch (error: unknown) {
        waitRejected = error instanceof Error;
      }
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await entered.promise;
    expectJson(await post(started, CANCEL), 200, { status: 'idle' });
    expect(signal?.aborted).toBe(true);
    expect(waitRejected).toBe(true);
    await expectMissing(stagingPath(started.dataDir));
  });

  it('cancel of a review returns idle and keeps stored photos', async () => {
    const started = await startAdmin(async (options) => {
      await writeBundle(options.stagingDir, PORTRAIT_NAME, false, 0);
      return doneResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const file = portraitFileName();
    await until(started.server.port, (value) => isRecord(value) && value.status === 'review');
    expectJson(await post(started, CANCEL), 200, { status: 'idle' });
    const image = await call(started.server.port, 'GET', `/api/photos/${file}`);
    expect(image.status).toBe(200);
    expect(Buffer.compare(image.body, Buffer.from(minimalJpeg()))).toBe(0);
    expect(await photoNames(started.dataDir)).toEqual([file]);
  });

  it('starting again after review runs a new collection', async () => {
    let round = 0;
    const started = await startAdmin(async (options) => {
      round += 1;
      const name = round === 1 ? 'First Portrait' : 'Second Portrait';
      await writeBundle(options.stagingDir, name, false, round);
      return doneResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const file = portraitFileName();
    const first = await until(started.server.port, (value) => isRecord(value) && value.status === 'review');
    expect(first).toEqual({
      status: 'review',
      progress: '',
      bundle: {
        portraits: [{ name: 'First Portrait', file, photoRef: file, duplicateName: false }],
        missing: [],
        skippedHousehold: 1,
      },
    });
    const again = await post(started, COLLECTION);
    expect(again.status).not.toBe(409);
    expectJson(again, 200, { status: 'running' });
    const second = await until(started.server.port, (value) => {
      if (!isRecord(value) || !isRecord(value.bundle) || !isUnknownArray(value.bundle.portraits)) return false;
      const portrait = value.bundle.portraits[0];
      return isRecord(portrait) && portrait.name === 'Second Portrait';
    });
    expect(second).toEqual({
      status: 'review',
      progress: '',
      bundle: {
        portraits: [{ name: 'Second Portrait', file, photoRef: file, duplicateName: false }],
        missing: [],
        skippedHousehold: 2,
      },
    });
  });

  it('close aborts the job and deletes staging', async () => {
    let signal: AbortSignal | undefined;
    const entered = defer();
    const started = await startAdmin(async (options) => {
      signal = options.signal;
      const waiting = options.waitForSignIn('Sign in.');
      entered.resolve();
      try {
        await waiting;
      } catch (error: unknown) {
        signal = options.signal;
        if (!(error instanceof Error)) throw error;
      }
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await entered.promise;
    expectJson(await get(started), 200, { status: 'needs-sign-in', progress: 'Sign in.' });
    await started.server.close();
    expect(signal?.aborted).toBe(true);
    await expectMissing(stagingPath(started.dataDir));
  });

  it('a symlink staging path is not removed or collected', async () => {
    let calls = 0;
    const started = await startAdmin(() => {
      calls += 1;
      return Promise.resolve(cancelledResult());
    });
    const target = path.join(path.dirname(started.dataDir), 'symlink-target');
    await mkdir(target);
    await writeFile(path.join(target, 'kept.txt'), 'kept');
    const link = stagingPath(started.dataDir);
    await symlink(target, link);
    expectJson(await post(started, COLLECTION), 500, { error: 'staging_unavailable' });
    expect(calls).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(target);
    expect(await readdir(target)).toEqual(['kept.txt']);
    expect(await readFile(path.join(target, 'kept.txt'), 'utf8')).toBe('kept');
  });

  it('a backup omits collector staging', async () => {
    const marker = 'collector-staging-marker-9f3a';
    const ready = defer();
    const started = await startAdmin(async (options) => {
      await writeFile(path.join(options.stagingDir, marker), marker);
      ready.resolve();
      await options.waitForSignIn('Sign in.');
      return cancelledResult();
    });
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    await ready.promise;
    expect(await readFile(path.join(stagingPath(started.dataDir), marker), 'utf8')).toBe(marker);
    const read = readTar(await createBackup(started.dataDir, clock));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.some((entry) => entry.name === 'wardboard.sqlite')).toBe(true);
    expect(read.entries.some((entry) => entry.name.includes('collector-staging') || entry.name.includes(marker))).toBe(
      false,
    );
    expect(read.entries.some((entry) => entry.bytes.toString('utf8').includes(marker))).toBe(false);
  });

  it('two servers do not share a job', async () => {
    const entered = defer();
    let callsOnB = 0;
    const serverA = await startAdmin(async (options) => {
      entered.resolve();
      await options.waitForSignIn('Sign in.');
      return cancelledResult();
    });
    const serverB = await startAdmin(() => {
      callsOnB += 1;
      return Promise.resolve(cancelledResult());
    });
    expectJson(await post(serverA, COLLECTION), 200, { status: 'running' });
    await entered.promise;
    expectJson(await get(serverB), 200, { status: 'idle', progress: '' });
    expect(callsOnB).toBe(0);
    const viewA = JSON.parse((await get(serverA)).body.toString('utf8')) as unknown;
    expect(isRecord(viewA) && viewA.status).not.toBe('idle');
  });

  it('a thrown collector becomes a fixed failure message', async () => {
    const started = await startAdmin(() => Promise.reject(new Error(`browser crashed: ${PORTRAIT_NAME}`)));
    expectJson(await post(started, COLLECTION), 200, { status: 'running' });
    const body = await until(started.server.port, (value) => isRecord(value) && value.status === 'failed');
    expect(body).toEqual({ status: 'failed', progress: '', message: 'Collection failed.' });
    await expectMissing(stagingPath(started.dataDir));
  });

  it('cancel while idle is refused', async () => {
    let calls = 0;
    const started = await startAdmin(() => {
      calls += 1;
      return Promise.resolve(cancelledResult());
    });
    expectJson(await post(started, CANCEL), 409, { error: 'not_running' });
    expectJson(await get(started), 200, { status: 'idle', progress: '' });
    expect(calls).toBe(0);
  });
});
