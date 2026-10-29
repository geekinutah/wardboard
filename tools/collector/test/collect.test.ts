import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALWAYS_FAILING,
  CANARIES,
  FIXTURE_NAMES,
  HOUSEHOLD_IMAGE_COUNT,
  HOUSEHOLDS,
  IMAGES,
  startDirectoryServer,
  type DirectoryServer,
} from './support/directory-server.ts';
import { sha256 } from './support/images.ts';
import {
  bundleDir,
  fixtureConfig,
  listFiles,
  readManifest,
  removeTemp,
  runCollector,
  tempStaging,
  type Manifest,
  type Run,
} from './support/run.ts';

const file = (image: string): string => {
  const bytes = IMAGES[image];
  if (bytes === undefined) throw new Error(`no fixture image ${image}`);
  return `${sha256(bytes)}.${image.endsWith('.png') ? 'png' : 'jpg'}`;
};

/** The manifest an uninterrupted run over the fictional directory must produce. */
export const EXPECTED_PORTRAITS = [
  { name: 'Ada Fictional', file: file('ada.png'), duplicateName: false },
  { name: 'Cal Sample', file: file('cal-delta.png'), duplicateName: true },
  { name: 'Cal Sample', file: file('cal-epsilon.png'), duplicateName: true },
  { name: 'Dee Imaginary', file: file('dee.jpg'), duplicateName: false },
  { name: 'Eli Madeup', file: file('eli.png'), duplicateName: false },
  { name: 'Gus Flaky', file: file('gus.jpg'), duplicateName: false },
  { name: 'Hal Twin', file: file('hal.png'), duplicateName: false },
  { name: 'Ivy Twin', file: file('ivy.png'), duplicateName: false },
].sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

describe('a full run over the fictional directory', () => {
  let server: DirectoryServer;
  let staging: string;
  let run: Run;
  let manifest: Manifest;

  beforeAll(async () => {
    server = await startDirectoryServer();
    staging = await tempStaging();
    run = await runCollector(staging, await fixtureConfig(server));
    manifest = (await readManifest(staging)).manifest;
  });

  afterAll(async () => {
    await server.close();
    await removeTemp(staging);
  });

  it('collects individual portraits and skips household images', async () => {
    expect(run.result).toMatchObject({ status: 'done', exitCode: 0 });
    expect(manifest.format).toBe('wardboard-photo-bundle');
    expect(manifest.version).toBe(1);
    expect(manifest.layoutVersion).toBe('directory-v1');
    expect(manifest.portraits).toEqual(EXPECTED_PORTRAITS);
    expect(manifest.skippedHousehold).toBe(HOUSEHOLD_IMAGE_COUNT);
    expect(HOUSEHOLD_IMAGE_COUNT).toBe(2);

    const files = await listFiles(bundleDir(staging));
    const householdHashes = HOUSEHOLDS.flatMap((h) => (h.image === undefined ? [] : [sha256(IMAGES[h.image] ?? Buffer.alloc(0))]));
    expect(householdHashes).toHaveLength(2);
    for (const name of files) {
      const bytes = await readFile(join(bundleDir(staging), name));
      expect(householdHashes).not.toContain(sha256(bytes));
    }
    // Household images were never downloaded, not even by the page itself.
    expect(server.photoRequests('household-beta.png')).toBe(0);
    expect(server.photoRequests('household-epsilon.png')).toBe(0);
  });

  it('records members with no portrait and failed images as missing', () => {
    expect(manifest.missing).toEqual([
      { name: 'Ben Example', reason: 'none' },
      { name: 'Fay Failing', reason: 'failed' },
    ]);
    expect(manifest.portraits.map((p) => p.name)).toContain('Gus Flaky');
    expect(run.logs.at(-1)).toBe(
      `Done. 8 portraits, 2 missing, 1 failed, 2 household images skipped. Bundle: ${bundleDir(staging)}`,
    );
  });

  it('retries are bounded', () => {
    // retries.image is 2 in the fixture config: 1 attempt + 2 retries.
    expect(server.photoRequests(ALWAYS_FAILING)).toBe(3);
    expect(server.photoRequests('gus.jpg')).toBe(2);
    expect(server.photoRequests('ada.png')).toBe(1);
  });

  it('namesakes are kept and flagged', () => {
    const cals = manifest.portraits.filter((p) => p.name === 'Cal Sample');
    expect(cals).toHaveLength(2);
    expect(new Set(cals.map((c) => c.file)).size).toBe(2);
    expect(cals.every((c) => c.duplicateName)).toBe(true);
    expect(manifest.portraits.filter((p) => p.name !== 'Cal Sample').every((p) => !p.duplicateName)).toBe(true);
  });

  it('identical bytes are written once', async () => {
    const hal = manifest.portraits.find((p) => p.name === 'Hal Twin');
    const ivy = manifest.portraits.find((p) => p.name === 'Ivy Twin');
    expect(hal?.file).toBeDefined();
    expect(hal?.file).toBe(ivy?.file);
    const files = await listFiles(bundleDir(staging));
    expect(files.filter((f) => f === hal?.file)).toHaveLength(1);
    // 7 distinct portrait byte strings plus the manifest.
    expect(files).toEqual([...new Set(EXPECTED_PORTRAITS.map((p) => p.file)), 'manifest.json'].sort());
    expect(files).toHaveLength(8);
    for (const name of files.filter((f) => f !== 'manifest.json')) {
      const bytes = await readFile(join(bundleDir(staging), name));
      expect(`${sha256(bytes)}.${name.split('.')[1] ?? ''}`).toBe(name);
    }
  });

  it('fetches use the signed-in context', () => {
    const portraitRequests = server.requests.filter((r) => r.path.startsWith('/photos/'));
    expect(portraitRequests.length).toBeGreaterThanOrEqual(10);
    expect(portraitRequests.every((r) => r.session)).toBe(true);
    expect(portraitRequests.filter((r) => r.status === 403)).toEqual([]);
    expect(server.requests.filter((r) => r.status === 403)).toEqual([]);
  });

  it('no canary value reaches staging, logs or the manifest', async () => {
    // The fixture pages really do carry the canaries the collector must drop.
    expect(CANARIES.length).toBeGreaterThan(5);
    const files = await listFiles(staging);
    expect(files).toContain(join('wardboard-collector', 'bundle', 'manifest.json'));
    expect(files).toContain(join('wardboard-collector', 'state.json'));
    for (const name of files) {
      const content = (await readFile(join(staging, name))).toString('latin1');
      for (const canary of CANARIES) {
        expect(content, `${name} contains ${canary}`).not.toContain(canary);
        expect(name).not.toContain(canary);
      }
      // No URLs or household names in any file.
      expect(content, `${name} contains a URL`).not.toContain(server.origin);
      expect(content).not.toContain('/photos/');
      for (const household of HOUSEHOLDS) expect(content).not.toContain(household.name);
    }
    const allLogs = run.logs.join('\n');
    for (const canary of CANARIES) expect(allLogs).not.toContain(canary);
    expect(allLogs).not.toContain('127.0.0.1');
    for (const name of FIXTURE_NAMES) expect(allLogs).not.toContain(name);
    expect(run.logs.some((line) => line.startsWith('Households 5 of 5'))).toBe(true);
  });

  it('only the fixture host is contacted', () => {
    // Recorded by the test itself (support/observe.ts), not reported by the collector.
    const { node, browser } = run.requests;
    const fixtureHost = new URL(server.origin).host;
    for (const url of [...node, ...browser]) expect(new URL(url).host, url).toBe(fixtureHost);
    // Both observers really saw this run: page navigations in the browser, and
    // the collector's portrait fetches through context.request in this process.
    expect(browser.some((url) => new URL(url).pathname === '/households')).toBe(true);
    expect(browser.some((url) => new URL(url).pathname === '/households/0')).toBe(true);
    expect(node.some((url) => new URL(url).pathname === '/photos/ada.png')).toBe(true);
    // Every request the fixture server answered was seen by an observer.
    const seenPaths = new Set([...node, ...browser].map((url) => `${new URL(url).pathname}${new URL(url).search}`));
    expect(server.requests.length).toBeGreaterThan(5);
    for (const request of server.requests) expect(seenPaths, request.path).toContain(request.path);
  });
});

describe('portrait validation', () => {
  it('a sign-in page or an oversized image at a portrait URL is missing, never written', async () => {
    const MiB = 1024 * 1024;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const padded = (size: number): Buffer => Buffer.concat([pngSignature, Buffer.alloc(size - pngSignature.length, 7)]);
    const signInPage = Buffer.from(
      '<!doctype html><html><body><form action="/signin"><input name="user"><p>CANARY-SIGNIN-PAGE</p></form></body></html>',
      'utf8',
    );
    const oversize = padded(6 * MiB);
    const atLimit = padded(5 * MiB);
    const server = await startDirectoryServer({
      households: [
        {
          name: 'Fictional Household Zeta',
          members: [
            { name: 'Ada Fictional', photo: 'ada.png' },
            { name: 'Kit Signin', photo: 'signin-page.jpg' },
            { name: 'Joy Oversize', photo: 'oversize.png' },
            { name: 'Lou Limit', photo: 'at-limit.png' },
          ],
        },
      ],
      photos: {
        'signin-page.jpg': { type: 'text/html', body: signInPage },
        'oversize.png': { type: 'image/png', body: oversize },
        'at-limit.png': { type: 'image/png', body: atLimit },
      },
    });
    const staging = await tempStaging();
    try {
      const run = await runCollector(staging, await fixtureConfig(server));
      expect(run.result).toMatchObject({ status: 'done', exitCode: 0 });
      const { manifest } = await readManifest(staging);
      expect(manifest.missing).toEqual([
        { name: 'Joy Oversize', reason: 'failed' },
        { name: 'Kit Signin', reason: 'failed' },
      ]);
      expect(manifest.portraits).toEqual([
        { name: 'Ada Fictional', file: file('ada.png'), duplicateName: false },
        { name: 'Lou Limit', file: `${sha256(atLimit)}.png`, duplicateName: false },
      ]);
      // They were fetched (with bounded retries) and rejected, not skipped.
      expect(server.photoRequests('signin-page.jpg')).toBe(3);
      expect(server.photoRequests('oversize.png')).toBe(3);
      expect(run.logs.at(-1)).toBe(
        `Done. 2 portraits, 2 missing, 2 failed, 0 household images skipped. Bundle: ${bundleDir(staging)}`,
      );

      expect(await listFiles(bundleDir(staging))).toEqual(
        [file('ada.png'), `${sha256(atLimit)}.png`, 'manifest.json'].sort(),
      );
      for (const name of await listFiles(staging)) {
        const bytes = await readFile(join(staging, name));
        expect(sha256(bytes), name).not.toBe(sha256(signInPage));
        expect(sha256(bytes), name).not.toBe(sha256(oversize));
        expect(bytes.length, name).toBeLessThanOrEqual(5 * MiB);
        expect(bytes.toString('latin1'), name).not.toContain('CANARY-SIGNIN-PAGE');
      }
    } finally {
      await server.close();
      await removeTemp(staging);
    }
  });
});

describe('repeat runs', () => {
  it('repeat runs produce byte-identical manifests', async () => {
    const server = await startDirectoryServer();
    const first = await tempStaging();
    const second = await tempStaging();
    try {
      const config = await fixtureConfig(server);
      expect((await runCollector(first, config)).result.status).toBe('done');
      expect((await runCollector(second, config)).result.status).toBe('done');
      const a = await readManifest(first);
      const b = await readManifest(second);
      expect(a.text).toBe(b.text);
      expect(a.text.endsWith('}\n')).toBe(true);
      expect(a.text).toBe(`${JSON.stringify(a.manifest, null, 2)}\n`);
      expect(Object.keys(a.manifest).sort()).toEqual(
        ['format', 'layoutVersion', 'missing', 'portraits', 'skippedHousehold', 'version'].sort(),
      );
      expect(await listFiles(bundleDir(first))).toEqual(await listFiles(bundleDir(second)));
    } finally {
      await server.close();
      await removeTemp(first);
      await removeTemp(second);
    }
  });
});
