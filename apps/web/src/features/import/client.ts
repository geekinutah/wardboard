import type { ImportPreview, ImportResolution } from './plan.ts';

export type ImportFetch = typeof fetch;

export type ImportPreviewFailure = 'forbidden' | 'bad_request' | 'too_large' | 'offline';

export type ImportReplaceFailure =
  | ImportPreviewFailure
  | 'duplicate_report'
  | 'inconsistent_reports'
  | 'unresolved'
  | 'stale';

export type ImportPreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; code: ImportPreviewFailure };

export type ImportReplaceResult =
  | { ok: true; matched: number; created: number; removed: number }
  | { ok: false; code: ImportReplaceFailure; currentVersion?: number };

export type ImportReportFiles = {
  organizations: string;
  withoutCallings: string;
  outOfUnit: string;
};

const REPLACE_CONFLICTS = ['duplicate_report', 'inconsistent_reports', 'unresolved', 'stale'] as const;

type ReplaceConflict = (typeof REPLACE_CONFLICTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isConflict(value: string): value is ReplaceConflict {
  return (REPLACE_CONFLICTS as readonly string[]).includes(value);
}

function isPreview(value: unknown): value is ImportPreview {
  return isRecord(value) && Array.isArray(value.decisions);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim() === '') return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function failureFor(status: number, body: unknown, replace: boolean): { ok: false; code: ImportReplaceFailure; currentVersion?: number } {
  if (status === 401 || status === 403) return { ok: false, code: 'forbidden' };
  if (status === 413) return { ok: false, code: 'too_large' };
  if (replace && status === 409 && isRecord(body) && typeof body.error === 'string' && isConflict(body.error)) {
    if (body.error === 'stale' && typeof body.currentVersion === 'number' && Number.isFinite(body.currentVersion)) {
      return { ok: false, code: 'stale', currentVersion: body.currentVersion };
    }
    return { ok: false, code: body.error };
  }
  return { ok: false, code: 'bad_request' };
}

async function postJson(fetchImpl: ImportFetch, url: string, body: unknown): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postImportPreview(fetchImpl: ImportFetch, body: ImportReportFiles): Promise<ImportPreviewResult> {
  let response: Response;
  try {
    response = await postJson(fetchImpl, '/api/import/preview', body);
  } catch {
    return { ok: false, code: 'offline' };
  }
  const payload = await readJson(response);
  if (response.status === 200 && isPreview(payload)) return { ok: true, preview: payload };
  if (response.status === 401 || response.status === 403) return { ok: false, code: 'forbidden' };
  if (response.status === 413) return { ok: false, code: 'too_large' };
  return { ok: false, code: 'bad_request' };
}

export async function postImportReplace(
  fetchImpl: ImportFetch,
  body: ImportReportFiles & {
    expectedVersion: number;
    resolutions: Record<string, ImportResolution>;
  },
): Promise<ImportReplaceResult> {
  let response: Response;
  try {
    response = await postJson(fetchImpl, '/api/import/replace', body);
  } catch {
    return { ok: false, code: 'offline' };
  }
  const payload = await readJson(response);
  if (response.status === 200 && isRecord(payload) && isCount(payload.matched) && isCount(payload.created) && isCount(payload.removed)) {
    return { ok: true, matched: payload.matched, created: payload.created, removed: payload.removed };
  }
  return failureFor(response.status, payload, true);
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const end = Math.min(index + chunkSize, bytes.length);
    let piece = '';
    for (let cursor = index; cursor < end; cursor += 1) {
      const byte = bytes[cursor];
      if (byte === undefined) continue;
      piece += String.fromCharCode(byte);
    }
    binary += piece;
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return encodeBase64(bytes);
}

export async function readReportFiles(files: {
  organizations: File;
  withoutCallings: File;
  outOfUnit: File;
}): Promise<ImportReportFiles> {
  const [organizations, withoutCallings, outOfUnit] = await Promise.all([
    fileToBase64(files.organizations),
    fileToBase64(files.withoutCallings),
    fileToBase64(files.outOfUnit),
  ]);
  return { organizations, withoutCallings, outOfUnit };
}
