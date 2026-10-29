import type { IncomingMessage, ServerResponse } from 'node:http';
import { boardId } from '@wardboard/core';
import { extractPdf, importReports, type ImportBundle } from '@wardboard/importer';
import type { Role } from '../access/index.ts';
import type { Store } from '../store/index.ts';
import type { OperationChannel } from '../ws/channel.ts';
import { applyImport } from './apply.ts';
import { emptyCurrentBoard } from './empty.ts';
import { planImport } from './plan.ts';
import type { ImportFingerprints, ImportPlan, ImportResolution, ImportResolutions } from './types.ts';

const MAX_IMPORT_BYTES = 2_000_000;
const FINGERPRINT_VERSION = /^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
/** Id of the empty Current a first-import preview plans against. Never stored. */
const PREVIEW_BOARD_ID = 'first-import-preview';

export type ImportHttpInput = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  role: Role;
  appOrigin: string;
  listenOrigin: string;
  store: Store;
  channel: OperationChannel;
  clock: () => Date;
  ids: () => string;
  log?: (line: string) => void;
};

function sendJson(res: ServerResponse, status: number, body: string, extra?: Readonly<Record<string, string>>): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': String(payload.byteLength),
    ...(extra ?? {}),
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

function discard(req: IncomingMessage): void {
  req.on('error', () => undefined);
  req.resume();
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

function readBody(req: IncomingMessage, max: number): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  if (overDeclaredLength(req.headers['content-length'], max)) return Promise.resolve({ ok: false });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const stop = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const finish = (result: { ok: true; bytes: Buffer } | { ok: false }): void => {
      if (settled) return;
      settled = true;
      stop();
      resolve(result);
    };
    const onData = (chunk: unknown): void => {
      const buf = asBuffer(chunk);
      received += buf.byteLength;
      if (received > max) {
        req.pause();
        finish({ ok: false });
        return;
      }
      chunks.push(buf);
    };
    const onEnd = (): void => {
      finish({ ok: true, bytes: Buffer.concat(chunks) });
    };
    const onError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      stop();
      reject(error instanceof Error ? error : new Error('upload failed'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

function decodePdf(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return null;
  if (value.startsWith('data:') || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return null;
  return new Uint8Array(bytes);
}

function bundleFrom(value: Record<string, unknown>): ImportBundle | null {
  const organizations = decodePdf(value.organizations);
  const withoutCallings = decodePdf(value.withoutCallings);
  const outOfUnit = decodePdf(value.outOfUnit);
  if (organizations === null || withoutCallings === null || outOfUnit === null) return null;
  return importReports({
    organizations: extractPdf(organizations),
    withoutCallings: extractPdf(withoutCallings),
    outOfUnit: extractPdf(outOfUnit),
  });
}

function previousFingerprints(importVersion: string): ImportFingerprints | undefined {
  if (!FINGERPRINT_VERSION.test(importVersion)) return undefined;
  const parts = importVersion.split('.');
  const organizations = parts[0];
  const withoutCallings = parts[1];
  const outOfUnit = parts[2];
  if (organizations === undefined || withoutCallings === undefined || outOfUnit === undefined) return undefined;
  return { organizations, 'without-callings': withoutCallings, 'out-of-unit': outOfUnit };
}

function versionOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function parseResolution(value: unknown): ImportResolution | null {
  if (!isRecord(value)) return null;
  if (value.action === 'match') {
    if (typeof value.memberId !== 'string' || value.memberId.length === 0) return null;
    const keys = Object.keys(value);
    if (keys.length === 2 && exactKeys(value, ['action', 'memberId'])) {
      return { action: 'match', memberId: value.memberId };
    }
    if (keys.length === 3 && exactKeys(value, ['action', 'memberId', 'confirmReturn']) && value.confirmReturn === true) {
      return { action: 'match', memberId: value.memberId, confirmReturn: true };
    }
    return null;
  }
  if (value.action === 'new') {
    if (!exactKeys(value, Object.hasOwn(value, 'category') ? ['action', 'category'] : ['action'])) return null;
    if (!Object.hasOwn(value, 'category')) return { action: 'new' };
    if (value.category !== 'adult' && value.category !== 'youth') return null;
    return { action: 'new', category: value.category };
  }
  return null;
}

function parseResolutions(value: unknown): ImportResolutions | null {
  if (!isRecord(value)) return null;
  const resolutions: Record<string, ImportResolution> = {};
  for (const [key, raw] of Object.entries(value)) {
    const resolution = parseResolution(raw);
    if (resolution === null) return null;
    resolutions[key] = resolution;
  }
  return resolutions;
}

function previewJson(plan: ImportPlan): string {
  return JSON.stringify({
    decisions: plan.decisions,
    absent: plan.absent,
    duplicates: plan.duplicates,
    inconsistentReports: plan.inconsistentReports,
    returning: plan.returning,
    needsCategory: plan.needsCategory,
    unfamiliar: plan.unfamiliar,
    keptPositions: plan.keptPositions,
    matchedPositions: plan.matchedPositions,
  });
}

function previewLog(plan: ImportPlan): string {
  let matched = 0;
  let created = 0;
  let ambiguous = 0;
  for (const decision of plan.decisions) {
    if (decision.kind === 'matched') matched += 1;
    else if (decision.kind === 'new') created += 1;
    else ambiguous += 1;
  }
  return `import preview matched=${String(matched)} new=${String(created)} ambiguous=${String(ambiguous)} absent=${String(plan.absent.length)} duplicates=${String(plan.duplicates.length)}`;
}

function refusal(error: 'duplicate_report' | 'inconsistent_reports' | 'unresolved' | 'stale', currentVersion?: number): string {
  if (error === 'stale') return JSON.stringify({ error: 'stale', currentVersion });
  return JSON.stringify({ error });
}

/**
 * Plans the import against the stored Current, or against an empty Current with
 * the given id when the ward has none yet (the first import).
 */
function planCurrent(store: Store, bundle: ImportBundle, firstBoardId: () => string): ImportPlan {
  const current = store.loadCurrent();
  if (current === null) {
    return planImport({ bundle, ward: store.loadWard(), current: emptyCurrentBoard(boardId(firstBoardId())) });
  }
  const previous = previousFingerprints(current.importVersion);
  return planImport({
    bundle,
    ward: store.loadWard(),
    current: current.board,
    ...(previous === undefined ? {} : { previousFingerprints: previous }),
  });
}

type Applied = Extract<ReturnType<typeof applyImport>, { ok: true }>;
type Stored = { ok: true; importVersion: string; importedAt: string } | { ok: false; stale?: number };

function replaceStored(store: Store, applied: Applied, expectedVersion: number): Stored {
  const replaced = store.replaceCurrent({
    ward: applied.ward,
    current: applied.current,
    expectedVersion,
    importVersion: applied.importVersion,
    importedAt: applied.importedAt,
  });
  if (!replaced.ok) {
    return replaced.error.code === 'stale' ? { ok: false, stale: replaced.error.currentVersion } : { ok: false };
  }
  return { ok: true, importVersion: replaced.value.current.importVersion, importedAt: replaced.value.current.importedAt };
}

/** Writes the ward's first Current. A concurrent first import that already won makes this one stale. */
export function initializeCurrent(store: Store, applied: Applied): Stored {
  const initialized = store.initialize({
    ward: applied.ward,
    current: applied.current,
    importVersion: applied.importVersion,
  });
  if (!initialized.ok) {
    if (initialized.error.code === 'already_initialized') {
      const winner = store.loadCurrent();
      return { ok: false, stale: winner === null ? 0 : winner.board.version };
    }
    return { ok: false };
  }
  const created = store.loadCurrent();
  if (created === null) return { ok: false };
  return { ok: true, importVersion: created.importVersion, importedAt: created.importedAt };
}

export async function handleImportRequest(input: ImportHttpInput): Promise<void> {
  if (input.role !== 'admin') {
    discard(input.req);
    sendJson(input.res, 403, '{"error":"forbidden"}');
    return;
  }
  if (input.method !== 'POST') {
    discard(input.req);
    sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'POST' });
    return;
  }
  if (!originAllowed(input.req.headers.origin, input.appOrigin, input.listenOrigin)) {
    discard(input.req);
    sendJson(input.res, 403, '{"error":"forbidden"}');
    return;
  }
  if (overDeclaredLength(input.req.headers['content-length'], MAX_IMPORT_BYTES)) {
    discard(input.req);
    sendJson(input.res, 413, '{"error":"too_large"}');
    return;
  }
  const upload = await readBody(input.req, MAX_IMPORT_BYTES);
  if (!upload.ok) {
    sendTooLarge(input.req, input.res);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(upload.bytes.toString('utf8')) as unknown;
  } catch {
    sendJson(input.res, 400, '{"error":"bad_request"}');
    return;
  }
  if (!isRecord(parsed)) {
    sendJson(input.res, 400, '{"error":"bad_request"}');
    return;
  }

  try {
    if (input.pathname === '/api/import/preview') {
      if (!exactKeys(parsed, ['organizations', 'withoutCallings', 'outOfUnit'])) {
        sendJson(input.res, 400, '{"error":"bad_request"}');
        return;
      }
      const bundle = bundleFrom(parsed);
      if (bundle === null) {
        sendJson(input.res, 400, '{"error":"bad_request"}');
        return;
      }
      const plan = planCurrent(input.store, bundle, () => PREVIEW_BOARD_ID);
      input.log?.(previewLog(plan));
      sendJson(input.res, 200, previewJson(plan));
      return;
    }

    if (!exactKeys(parsed, ['organizations', 'withoutCallings', 'outOfUnit', 'expectedVersion', 'resolutions'])) {
      sendJson(input.res, 400, '{"error":"bad_request"}');
      return;
    }
    const expectedVersion = versionOf(parsed.expectedVersion);
    const resolutions = parseResolutions(parsed.resolutions);
    if (expectedVersion === null || resolutions === null) {
      sendJson(input.res, 400, '{"error":"bad_request"}');
      return;
    }
    const bundle = bundleFrom(parsed);
    if (bundle === null) {
      sendJson(input.res, 400, '{"error":"bad_request"}');
      return;
    }
    const first = input.store.loadCurrent() === null;
    if (first && expectedVersion !== 0) {
      sendJson(input.res, 409, refusal('stale', 0));
      return;
    }
    const plan = planCurrent(input.store, bundle, input.ids);
    const applied = applyImport({
      plan,
      resolutions,
      expectedVersion,
      ids: input.ids,
      clock: input.clock,
    });
    if (!applied.ok) {
      sendJson(
        input.res,
        409,
        applied.error === 'stale' ? refusal('stale', applied.currentVersion) : refusal(applied.error),
      );
      return;
    }
    const stored = first ? initializeCurrent(input.store, applied) : replaceStored(input.store, applied, expectedVersion);
    if (!stored.ok) {
      if (stored.stale !== undefined) {
        sendJson(input.res, 409, refusal('stale', stored.stale));
        return;
      }
      sendJson(input.res, 400, '{"error":"bad_request"}');
      return;
    }
    input.channel.publishImport();
    input.log?.(
      `import replace matched=${String(applied.matched)} created=${String(applied.created)} removed=${String(applied.removed)}`,
    );
    sendJson(
      input.res,
      200,
      JSON.stringify({
        replaced: true,
        importVersion: stored.importVersion,
        importedAt: stored.importedAt,
        matched: applied.matched,
        created: applied.created,
        removed: applied.removed,
      }),
    );
  } catch {
    if (!input.res.headersSent) sendJson(input.res, 400, '{"error":"bad_request"}');
  }
}
