import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sequentialIds } from '@wardboard/core';
import { canonicalName, extractPdf, importReports, type PdfDocument } from '@wardboard/importer';
import { afterEach, describe, expect, it } from 'vitest';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { importClock } from './helpers.ts';

const BASE_ORIGIN = 'http://wardboard.example';
const ADMIN_LOGIN = 'admin@example.test';
const ADMIN: Identity = { login: ADMIN_LOGIN, displayName: 'Admin Example' };

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/lcr-reports');
const organizationsPdf = readFileSync(path.join(fixturesDir, 'organizations-and-callings.pdf'));
const withoutPdf = readFileSync(path.join(fixturesDir, 'members-without-callings.pdf'));
const outPdf = readFileSync(path.join(fixturesDir, 'out-of-unit-callings.pdf'));
const memberListPdf = readFileSync(path.join(fixturesDir, 'member-list.pdf'));

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type HttpResult = { status: number; body: Buffer };
type Started = { server: RunningServer; dataDir: string; db: DatabaseSync };

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected socket chunk');
}

/** A real server on an ephemeral port over a migrated data directory with no Current. */
async function start(log?: (line: string) => void): Promise<Started> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-member-list-'));
  directories.push(root);
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  const setup = openDatabase(databasePath(dataDir));
  try {
    migrate(setup);
  } finally {
    setup.close();
  }
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    initialAdminLogin: ADMIN_LOGIN,
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(ADMIN),
    clock: importClock,
    ids: sequentialIds('member-list'),
    ...(log === undefined ? {} : { log }),
  });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  return { server, dataDir, db };
}

function post(started: Started, route: string, payload: unknown): Promise<HttpResult> {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: started.server.port,
        path: route,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
          origin: BASE_ORIGIN,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: unknown) => {
          chunks.push(bufferChunk(chunk));
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function threeFields(): { organizations: string; withoutCallings: string; outOfUnit: string } {
  return {
    organizations: organizationsPdf.toString('base64'),
    withoutCallings: withoutPdf.toString('base64'),
    outOfUnit: outPdf.toString('base64'),
  };
}

function fourFields(): ReturnType<typeof threeFields> & { memberList: string } {
  return { ...threeFields(), memberList: memberListPdf.toString('base64') };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object');
  return value as Record<string, unknown>;
}

function json(result: HttpResult): Record<string, unknown> {
  return asRecord(JSON.parse(result.body.toString('utf8')) as unknown);
}

function resolutionsFrom(preview: Record<string, unknown>): Record<string, { action: 'new'; category: 'adult' }> {
  const needs = preview.needsCategory;
  if (!Array.isArray(needs)) throw new Error('needsCategory missing');
  const resolutions: Record<string, { action: 'new'; category: 'adult' }> = {};
  for (const key of needs) {
    if (typeof key !== 'string') throw new Error('bad key');
    resolutions[key] = { action: 'new', category: 'adult' };
  }
  return resolutions;
}

/** People with a calling (organizations or out-of-unit) who have no Members without Callings age. */
function unagedWithCallings(): number {
  const bundle = importReports({
    organizations: extractPdf(new Uint8Array(organizationsPdf)),
    withoutCallings: extractPdf(new Uint8Array(withoutPdf)),
    outOfUnit: extractPdf(new Uint8Array(outPdf)),
    memberList: extractPdf(new Uint8Array(memberListPdf)),
  });
  const aged = new Set(bundle.withoutCallings.candidates.map((candidate) => canonicalName(candidate.name)));
  const called = new Set<string>();
  for (const organization of bundle.organizations.organizations) {
    for (const group of organization.groups) {
      for (const position of group.positions) {
        if (position.occupant !== null) called.add(canonicalName(position.occupant));
      }
    }
  }
  for (const calling of bundle.outOfUnit.externalCallings) called.add(canonicalName(calling.name));
  return [...called].filter((key) => !aged.has(key)).length;
}

/** Gender, birth date, phone and email cells of the Member List fixture, read by header x-positions. */
function discardedCells(doc: PdfDocument): { genders: Set<string>; values: Set<string> } {
  const headings = ['Name', 'Gender', 'Age', 'Birth Date', 'Phone Number', 'Email'];
  const genders = new Set<string>();
  const values = new Set<string>();
  for (const page of doc.pages) {
    const header = page.rows.find((row) => headings.every((heading, index) => row.items[index]?.text === heading));
    if (header === undefined) throw new Error('missing header');
    const xs = header.items.map((item) => item.x);
    const column = (x: number): number => {
      let index = 0;
      xs.forEach((start, at) => {
        if (start <= x + 1) index = at;
      });
      return index;
    };
    for (const row of page.rows) {
      if (row.y <= header.y) continue;
      const text = row.items.map((item) => item.text).join(' ');
      if (text.includes('For Church Use Only') || text.startsWith('Count:')) continue;
      for (const item of row.items) {
        const at = column(item.x);
        if (at === 1) genders.add(item.text);
        if (at >= 3) values.add(item.text);
      }
    }
  }
  return { genders, values };
}

async function filesOf(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(full);
    }
  }
  await walk(root);
  return found.sort();
}

describe('member list route', () => {
  it('preview requires all four reports', async () => {
    const started = await start();

    expect((await post(started, '/api/import/preview', fourFields())).status).toBe(200);

    const three = await post(started, '/api/import/preview', threeFields());
    expect(three.status).toBe(400);
    expect(json(three)).toEqual({ error: 'bad_request' });

    const five = await post(started, '/api/import/preview', { ...fourFields(), photos: memberListPdf.toString('base64') });
    expect(five.status).toBe(400);
    expect(json(five)).toEqual({ error: 'bad_request' });

    const { memberList, ...rest } = fourFields();
    const misspelled = await post(started, '/api/import/preview', { ...rest, memberlist: memberList });
    expect(misspelled.status).toBe(400);
    expect(json(misspelled)).toEqual({ error: 'bad_request' });

    const notBase64 = await post(started, '/api/import/preview', { ...fourFields(), memberList: 'not base64!' });
    expect(notBase64.status).toBe(400);

    const wrongReport = await post(started, '/api/import/preview', { ...fourFields(), memberList: rest.withoutCallings });
    expect(wrongReport.status).toBe(400);
    expect(json(wrongReport)).toEqual({ error: 'bad_request' });
  });

  it('replace requires all four reports', async () => {
    const started = await start();
    const previewed = json(await post(started, '/api/import/preview', fourFields()));
    const resolutions = resolutionsFrom(previewed);

    const three = await post(started, '/api/import/replace', { ...threeFields(), expectedVersion: 0, resolutions });
    expect(three.status).toBe(400);
    expect(json(three)).toEqual({ error: 'bad_request' });
    expect(openStore(started.db, importClock).loadCurrent()).toBeNull();

    const four = await post(started, '/api/import/replace', { ...fourFields(), expectedVersion: 0, resolutions });
    expect(four.status).toBe(200);
  });

  it('with the member list, fewer people need a category', async () => {
    const started = await start();
    const preview = await post(started, '/api/import/preview', fourFields());
    expect(preview.status).toBe(200);
    const body = json(preview);
    const needs = body.needsCategory;
    if (!Array.isArray(needs)) throw new Error('needsCategory missing');

    const unaged = unagedWithCallings();
    expect(unaged).toBe(145);
    expect(needs.length).toBeLessThan(unaged);
    // Only the Member List namesakes are left (fixtures/lcr-reports/README.md).
    expect(needs.map(String).sort()).toEqual(['fairwell, sage casey kendall reagan', 'westdale, gus']);
    expect(body.inconsistentReports).toBe(false);

    const replaced = await post(started, '/api/import/replace', {
      ...fourFields(),
      expectedVersion: 0,
      resolutions: resolutionsFrom(body),
    });
    expect(replaced.status).toBe(200);
    const ward = openStore(started.db, importClock).loadWard();
    const members = Object.values(ward.members);
    const stanley = members.find((member) => member.name === 'Stanley, Zed');
    expect(stanley?.category).toBe('adult');
    // A youth with a calling and no Members without Callings age: the Member List says youth.
    const youth = members.filter((member) => member.category === 'youth');
    expect(youth.length).toBeGreaterThan(0);
  });

  it('the member list leaves no discarded fields behind', async () => {
    const lines: string[] = [];
    const started = await start((line) => lines.push(line));
    const preview = json(await post(started, '/api/import/preview', fourFields()));
    const replaced = await post(started, '/api/import/replace', {
      ...fourFields(),
      expectedVersion: 0,
      resolutions: resolutionsFrom(preview),
    });
    expect(replaced.status).toBe(200);
    for (const db of databases.splice(0)) db.close();
    for (const server of servers.splice(0)) await server.close();

    const { genders, values } = discardedCells(extractPdf(new Uint8Array(memberListPdf)));
    expect([...genders].sort()).toEqual(['F', 'M']);
    expect(values.size).toBeGreaterThan(500);
    const files = await filesOf(started.dataDir);
    expect(files.length).toBeGreaterThan(0);
    const stored = (await Promise.all(files.map((file) => readFile(file)))).map((bytes) => bytes.toString('latin1'));
    const logText = lines.join('\n');
    expect(logText.length).toBeGreaterThan(0);
    for (const text of [...stored, logText]) {
      for (const value of values) expect(text.includes(value), value).toBe(false);
      expect(/gender/i.test(text)).toBe(false);
      for (const gender of genders) expect(text.includes(`"${gender}"`), gender).toBe(false);
    }
  });
});
