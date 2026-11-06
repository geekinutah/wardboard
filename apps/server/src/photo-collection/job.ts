import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { importPhotoBundle, type PhotoBundleResponse } from '../photos/bundle.ts';
import type { PhotoStore } from '../photos/store.ts';
import type { CollectResult, PhotoCollector } from './types.ts';

const STAGING_NAME = 'collector-staging';
const PORTRAIT_FILE = /^[0-9a-f]{64}\.(?:jpg|png)$/;

type Phase = 'idle' | 'running' | 'needs-sign-in' | 'review' | 'failed';

type Waiter = {
  resolve: () => void;
  reject: () => void;
};

export type PhotoCollection = {
  view(): string;
  start(): Promise<{ status: number; body: string }>;
  releaseWait(): { status: number; body: string };
  cancel(): Promise<{ status: number; body: string }>;
  shutdown(): Promise<void>;
};

export type PhotoCollectionOptions = {
  dataDir: string;
  photos: PhotoStore;
  collector: PhotoCollector | undefined;
  clock: () => Date;
  log?: (line: string) => void;
};

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stagingPath(dataDir: string): string {
  return path.join(dataDir, STAGING_NAME);
}

/** A symlink or any non-directory is left in place. `lstat` does not follow the link. */
async function removeStaging(staging: string): Promise<void> {
  let info;
  try {
    info = await lstat(staging);
  } catch (error: unknown) {
    if (isEnoent(error)) return;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  try {
    await rm(staging, { recursive: true });
  } catch (error: unknown) {
    if (isEnoent(error)) return;
    throw error;
  }
}

/**
 * Creates `<dataDir>/collector-staging` at mode 0700.
 * `mkdir`'s mode is widened by the process umask, so chmod pins it.
 * An existing symlink or non-directory is not removed.
 */
async function prepareStaging(staging: string): Promise<'ok' | 'unavailable'> {
  let existing;
  try {
    existing = await lstat(staging);
  } catch (error: unknown) {
    if (!isEnoent(error)) return 'unavailable';
  }
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) return 'unavailable';
    try {
      await rm(staging, { recursive: true });
    } catch {
      return 'unavailable';
    }
  }
  try {
    await mkdir(staging, { mode: 0o700 });
    await chmod(staging, 0o700);
    const created = await lstat(staging);
    if (created.isSymbolicLink() || !created.isDirectory()) return 'unavailable';
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

function containedPortrait(bundleDir: string, fileName: string): string | null {
  if (!PORTRAIT_FILE.test(fileName)) return null;
  const root = path.resolve(bundleDir);
  const resolved = path.resolve(root, fileName);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  if (relative.includes(path.sep)) return null;
  return resolved;
}

async function bundleRequest(
  stagingDir: string,
): Promise<{ manifest: unknown; files: Record<string, string> } | null> {
  const bundleDir = path.resolve(stagingDir, 'wardboard-collector', 'bundle');
  let text: string;
  try {
    text = await readFile(path.join(bundleDir, 'manifest.json'), 'utf8');
  } catch {
    return null;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.portraits)) return null;
  const files: Record<string, string> = {};
  for (const portrait of manifest.portraits) {
    if (!isRecord(portrait) || typeof portrait.file !== 'string') return null;
    const filePath = containedPortrait(bundleDir, portrait.file);
    if (filePath === null) return null;
    try {
      files[portrait.file] = (await readFile(filePath)).toString('base64');
    } catch {
      return null;
    }
  }
  return { manifest, files };
}

export function createPhotoCollection(options: PhotoCollectionOptions): PhotoCollection {
  const staging = stagingPath(options.dataDir);
  let phase: Phase = 'idle';
  let lastLog = '';
  let signInMessage = '';
  let bundle: PhotoBundleResponse | undefined;
  let failureMessage = '';
  let runId = 0;
  let controller: AbortController | undefined;
  let waiter: Waiter | undefined;
  let inflight: Promise<void> | undefined;

  function resetIdle(): void {
    phase = 'idle';
    lastLog = '';
    signInMessage = '';
    bundle = undefined;
    failureMessage = '';
    controller = undefined;
    waiter = undefined;
    inflight = undefined;
  }

  function view(): string {
    if (phase === 'idle') return JSON.stringify({ status: 'idle', progress: '' });
    if (phase === 'running') return JSON.stringify({ status: 'running', progress: lastLog });
    if (phase === 'needs-sign-in') return JSON.stringify({ status: 'needs-sign-in', progress: signInMessage });
    if (phase === 'review' && bundle !== undefined) {
      return JSON.stringify({ status: 'review', progress: lastLog, bundle });
    }
    return JSON.stringify({ status: 'failed', progress: lastLog, message: failureMessage });
  }

  function waitForSignIn(message: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    waiter?.reject();
    phase = 'needs-sign-in';
    signInMessage = message;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (kind: 'resolve' | 'reject'): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (waiter === current) waiter = undefined;
        if (kind === 'resolve') resolve();
        else reject(new Error('aborted'));
      };
      const onAbort = (): void => {
        finish('reject');
      };
      const current: Waiter = {
        resolve: () => {
          finish('resolve');
        },
        reject: () => {
          finish('reject');
        },
      };
      waiter = current;
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort);
    });
  }

  async function execute(id: number, active: AbortController, collector: PhotoCollector): Promise<void> {
    try {
      const result: CollectResult = await collector.collect({
        stagingDir: staging,
        config: collector.config,
        mode: 'new',
        browser: { headless: false },
        signal: active.signal,
        now: options.clock,
        log: (line) => {
          lastLog = line;
          options.log?.(line);
        },
        waitForSignIn: (message) => waitForSignIn(message, active.signal),
      });
      if (id !== runId) return;
      if (result.status !== 'done') {
        await removeStaging(staging);
        if (id !== runId) return;
        phase = 'failed';
        failureMessage = result.message;
        bundle = undefined;
        return;
      }
      const request = await bundleRequest(staging);
      const imported = request === null ? null : await importPhotoBundle(options.photos, request);
      if (id !== runId) return;
      await removeStaging(staging);
      if (id !== runId) return;
      if (imported === null) {
        phase = 'failed';
        failureMessage = 'The collected bundle could not be read.';
        bundle = undefined;
        return;
      }
      phase = 'review';
      bundle = imported;
      failureMessage = '';
    } catch {
      if (id === runId) await removeStaging(staging);
      if (id !== runId) return;
      phase = 'failed';
      failureMessage = 'Collection failed.';
      bundle = undefined;
    } finally {
      if (id === runId) {
        controller = undefined;
        waiter = undefined;
      }
    }
  }

  async function stopInFlight(): Promise<void> {
    controller?.abort();
    const pendingWait = waiter;
    waiter = undefined;
    pendingWait?.reject();
    const pending = inflight;
    if (pending !== undefined) await pending;
  }

  return {
    view,
    async start() {
      if (options.collector === undefined) return { status: 503, body: '{"error":"collector_unavailable"}' };
      if (phase === 'running' || phase === 'needs-sign-in') {
        return { status: 409, body: '{"error":"already_running"}' };
      }
      if ((await prepareStaging(staging)) !== 'ok') return { status: 500, body: '{"error":"staging_unavailable"}' };
      const collector = options.collector;
      phase = 'running';
      lastLog = '';
      signInMessage = '';
      bundle = undefined;
      failureMessage = '';
      const active = new AbortController();
      controller = active;
      const id = ++runId;
      const pending = execute(id, active, collector);
      inflight = pending;
      void pending.then(
        () => undefined,
        () => {
          if (id !== runId) return;
          phase = 'failed';
          failureMessage = 'Collection failed.';
        },
      );
      return { status: 200, body: '{"status":"running"}' };
    },
    releaseWait() {
      if (phase !== 'needs-sign-in' || waiter === undefined) return { status: 409, body: '{"error":"not_waiting"}' };
      const pendingWait = waiter;
      waiter = undefined;
      phase = 'running';
      pendingWait.resolve();
      return { status: 200, body: '{"status":"running"}' };
    },
    async cancel() {
      if (phase === 'idle') return { status: 409, body: '{"error":"not_running"}' };
      if (phase === 'running' || phase === 'needs-sign-in') await stopInFlight();
      await removeStaging(staging);
      resetIdle();
      return { status: 200, body: '{"status":"idle"}' };
    },
    async shutdown() {
      if (phase === 'running' || phase === 'needs-sign-in') await stopInFlight();
      await removeStaging(staging);
      resetIdle();
    },
  };
}
