import { existsSync, realpathSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * The collector's private staging area. The user chooses a parent folder;
 * the collector owns only `<parent>/wardboard-collector/` and, inside it, only
 * the files it records in `state.json`. Nothing else is ever deleted.
 */

export const WORK_DIR_NAME = 'wardboard-collector';
export const STATE_FILE = 'state.json';
export const MANIFEST_FILE = join('bundle', 'manifest.json');
const STATE_TEMP = 'state.json.tmp';
const MANIFEST_TEMP = join('bundle', 'manifest.json.tmp');
/** Files the collector always owns when they exist, besides recorded portraits. */
const FIXED_FILES = [MANIFEST_FILE, MANIFEST_TEMP, STATE_TEMP] as const;
const PORTRAIT_FILE = /^bundle\/[0-9a-f]{64}\.(?:jpg|png)$/;

export const RETENTION_DAYS = 7;

export type Portrait = { name: string; file: string };
export type Missing = { name: string; reason: 'none' | 'failed' };

/** Resume state. Holds names (needed for the bundle) but never URLs, household names or session data. */
export type State = {
  layoutVersion: string;
  startedAt: string;
  completedHouseholds: number[];
  portraits: Portrait[];
  missing: Missing[];
  skippedHousehold: number;
  failed: number;
  /** Portrait files this collector wrote, relative to the work dir (`bundle/<sha>.<ext>`). */
  createdFiles: string[];
};

export const workDirOf = (stagingDir: string): string => join(resolve(stagingDir), WORK_DIR_NAME);
export const bundleDirOf = (workDir: string): string => join(workDir, 'bundle');

/** True when `path` or any parent contains `.git` (a directory, or a worktree's `.git` file). */
export function insideGitRepository(path: string): boolean {
  const candidates = new Set<string>([resolve(path)]);
  // Also follow symlinks of the deepest existing ancestor.
  let existing = resolve(path);
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  try {
    candidates.add(realpathSync(existing));
  } catch {
    // An unreadable ancestor is checked by its resolved path only.
  }
  for (const start of candidates) {
    let current = start;
    for (;;) {
      if (existsSync(join(current, '.git'))) return true;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return false;
}

/** Creates the staging parent if needed, then the work dir and bundle dir with mode 0700. */
export async function createWorkDir(workDir: string): Promise<void> {
  await mkdir(dirname(workDir), { recursive: true });
  await mkdir(workDir, { mode: 0o700 });
  await chmod(workDir, 0o700);
  await ensureBundleDir(workDir);
}

export async function ensureBundleDir(workDir: string): Promise<void> {
  const bundle = bundleDirOf(workDir);
  await mkdir(bundle, { mode: 0o700, recursive: true });
  await chmod(bundle, 0o700);
}

/** Writes `relative` inside the work dir atomically: a temporary file, then a rename. */
async function writeAtomic(workDir: string, relative: string, temp: string, text: string): Promise<void> {
  const tempPath = join(workDir, temp);
  await writeFile(tempPath, text, { mode: 0o600 });
  await rename(tempPath, join(workDir, relative));
}

export async function writeState(workDir: string, state: State): Promise<void> {
  await writeAtomic(workDir, STATE_FILE, STATE_TEMP, `${JSON.stringify(state, null, 2)}\n`);
}

export async function writeManifestText(workDir: string, text: string): Promise<void> {
  await writeAtomic(workDir, MANIFEST_FILE, MANIFEST_TEMP, text);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Reads `state.json`; `undefined` when it is missing or not a state this collector wrote. */
export async function readState(workDir: string): Promise<State | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(workDir, STATE_FILE), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const s = raw as Partial<Record<keyof State, unknown>>;
  const valid =
    typeof s.layoutVersion === 'string' &&
    typeof s.startedAt === 'string' &&
    !Number.isNaN(Date.parse(s.startedAt)) &&
    Array.isArray(s.completedHouseholds) &&
    s.completedHouseholds.every((i) => Number.isInteger(i) && (i as number) >= 0) &&
    Array.isArray(s.portraits) &&
    s.portraits.every(
      (p: unknown) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Portrait).name === 'string' &&
        typeof (p as Portrait).file === 'string',
    ) &&
    Array.isArray(s.missing) &&
    s.missing.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as Missing).name === 'string' &&
        ((m as Missing).reason === 'none' || (m as Missing).reason === 'failed'),
    ) &&
    typeof s.skippedHousehold === 'number' &&
    typeof s.failed === 'number' &&
    isStringArray(s.createdFiles);
  return valid ? (raw as State) : undefined;
}

/** Recorded paths that are really collector portrait files; anything else in the record is ignored. */
async function recordedFiles(workDir: string): Promise<string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(workDir, STATE_FILE), 'utf8'));
  } catch {
    return [];
  }
  const created = typeof raw === 'object' && raw !== null ? (raw as { createdFiles?: unknown }).createdFiles : [];
  if (!isStringArray(created)) return [];
  return [...new Set(created.filter((path) => PORTRAIT_FILE.test(path)))];
}

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => !e.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // Not empty (or already gone): leave it.
  }
}

export type CleanupResult = { exitCode: 0 | 1; deleted: number; left: number; failed: number };

/**
 * Deletes only what the collector recorded (portraits, manifest, state and
 * their temporary files), then the bundle and work dirs if they are empty.
 * `state.json` goes last, and only when everything else was deleted, so a
 * failed cleanup can be retried.
 */
export async function cleanup(stagingDir: string, log: (line: string) => void): Promise<CleanupResult> {
  const workDir = workDirOf(stagingDir);
  if (!existsSync(workDir)) {
    log(`There is no collection to clean up in ${resolve(stagingDir)}.`);
    return { exitCode: 0, deleted: 0, left: 0, failed: 0 };
  }

  let deleted = 0;
  let failed = 0;
  const remove = async (relative: string): Promise<void> => {
    try {
      await unlink(join(workDir, relative));
      deleted += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed += 1;
    }
  };

  for (const relative of [...(await recordedFiles(workDir)), ...FIXED_FILES]) await remove(relative);
  if (failed === 0) await remove(STATE_FILE);

  await removeIfEmpty(bundleDirOf(workDir));
  await removeIfEmpty(workDir);
  const left = failed === 0 ? await countFiles(workDir) : 0;

  if (left > 0) log(`Left ${String(left)} files that the collector did not create in ${workDir}.`);
  if (failed > 0) {
    log(`Could not delete ${String(failed)} files in ${workDir}.`);
    return { exitCode: 1, deleted, left, failed };
  }
  log(existsSync(workDir) ? `Deleted the collector's files in ${workDir}.` : `Deleted the collection in ${workDir}.`);
  return { exitCode: 0, deleted, left, failed };
}
