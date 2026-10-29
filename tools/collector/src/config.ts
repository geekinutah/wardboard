import { readFile } from 'node:fs/promises';

/**
 * The directory layout the collector understands: explicit CSS selectors, a
 * layout version, timeouts and a bounded retry count (SPEC §15). Nothing here
 * is guessed at run time; an unmatched layout fails instead.
 */
export type DirectoryConfig = {
  layoutVersion: string;
  startUrl: string;
  selectors: Selectors;
  timeouts: { navigationMs: number; elementMs: number };
  retries: { image: number };
};

const SELECTOR_KEYS = [
  'householdList',
  'householdLink',
  'householdName',
  'householdImage',
  'memberEntry',
  'memberName',
  'memberPortrait',
  'signedOut',
] as const;

type Selectors = Record<(typeof SELECTOR_KEYS)[number], string>;

export class ConfigError extends Error {
  constructor(field: string) {
    super(`Invalid collector config: ${field}`);
    this.name = 'ConfigError';
  }
}

const MAX_IMAGE_RETRIES = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ConfigError(field);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new ConfigError(field);
  return value;
}

/** `https:` anywhere, or plain `http:` only on the loopback hosts the tests use. */
function startUrl(value: unknown): string {
  const text = nonEmptyString(value, 'startUrl');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError('startUrl');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return text;
  throw new ConfigError('startUrl');
}

export function parseConfig(value: unknown): DirectoryConfig {
  if (!isRecord(value)) throw new ConfigError('config');
  const layoutVersion = nonEmptyString(value.layoutVersion, 'layoutVersion');
  const url = startUrl(value.startUrl);

  const rawSelectors = value.selectors;
  if (!isRecord(rawSelectors)) throw new ConfigError('selectors');
  const selectors = {} as Selectors;
  for (const key of SELECTOR_KEYS) selectors[key] = nonEmptyString(rawSelectors[key], `selectors.${key}`);

  if (!isRecord(value.timeouts)) throw new ConfigError('timeouts');
  const navigationMs = positiveInteger(value.timeouts.navigationMs, 'timeouts.navigationMs');
  const elementMs = positiveInteger(value.timeouts.elementMs, 'timeouts.elementMs');

  if (!isRecord(value.retries)) throw new ConfigError('retries');
  const image = value.retries.image;
  if (typeof image !== 'number' || !Number.isInteger(image) || image < 0 || image > MAX_IMAGE_RETRIES) {
    throw new ConfigError('retries.image');
  }

  return { layoutVersion, startUrl: url, selectors, timeouts: { navigationMs, elementMs }, retries: { image } };
}

/** Reads and validates a config file. A missing or non-JSON file is `Invalid collector config: file`. */
export async function loadConfig(path: string): Promise<DirectoryConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new ConfigError('file');
  }
  return parseConfig(raw);
}
