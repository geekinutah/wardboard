import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { collect, type CollectOptions, type CollectResult } from '../../src/collect.ts';
import { parseConfig, type DirectoryConfig } from '../../src/config.ts';
import type { DirectoryServer } from './directory-server.ts';
import { observeRequests } from './observe.ts';

export const FIXTURE_CONFIG_PATH = new URL('../fixtures/directory.json', import.meta.url);

export async function rawFixtureConfig(server: DirectoryServer): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await readFile(FIXTURE_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  raw.startUrl = server.startUrl;
  return raw;
}

export async function fixtureConfig(
  server: DirectoryServer,
  edit: (raw: Record<string, unknown>) => void = () => undefined,
): Promise<DirectoryConfig> {
  const raw = await rawFixtureConfig(server);
  edit(raw);
  return parseConfig(raw);
}

/** A fresh staging parent outside any Git repository. */
export async function tempStaging(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'wb-collector-test-')));
}

export async function removeTemp(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export type Run = {
  result: CollectResult;
  logs: string[];
  signInMessages: string[];
  /** Every request of the run, recorded independently of the collector (see observe.ts). */
  requests: { node: string[]; sockets: string[]; browser: string[] };
};

export async function runCollector(
  stagingDir: string,
  config: DirectoryConfig,
  overrides: Partial<CollectOptions> = {},
  hooks: { onLog?: (line: string) => void; onSignIn?: (message: string) => void } = {},
): Promise<Run> {
  const logs: string[] = [];
  const signInMessages: string[] = [];
  const observer = observeRequests();
  const result = await collect({
    stagingDir,
    config,
    mode: 'new',
    browser: { headless: true },
    waitForSignIn: (message) => {
      signInMessages.push(message);
      hooks.onSignIn?.(message);
      return Promise.resolve();
    },
    log: (line) => {
      logs.push(line);
      hooks.onLog?.(line);
    },
    ...overrides,
  }).finally(observer.stop);
  return { result, logs, signInMessages, requests: { node: observer.node, sockets: observer.sockets, browser: observer.browser } };
}

/** Every file below `dir`, as sorted paths relative to it. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

export const workDir = (staging: string): string => join(staging, 'wardboard-collector');
export const bundleDir = (staging: string): string => join(staging, 'wardboard-collector', 'bundle');

export type Manifest = {
  format: string;
  version: number;
  layoutVersion: string;
  portraits: { name: string; file: string; duplicateName: boolean }[];
  missing: { name: string; reason: 'none' | 'failed' }[];
  skippedHousehold: number;
};

export async function readManifest(staging: string): Promise<{ text: string; manifest: Manifest }> {
  const text = await readFile(join(bundleDir(staging), 'manifest.json'), 'utf8');
  return { text, manifest: JSON.parse(text) as Manifest };
}
