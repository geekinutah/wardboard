import type { BackupSummary, RestoreErrorCode, RestoreResult } from '../features/settings/types.ts';

const RESTORE_CODES: ReadonlySet<string> = new Set<RestoreErrorCode>([
  'invalid_archive',
  'corrupt_database',
  'incompatible_schema',
  'missing_photo',
  'no_admin',
  'restore_failed',
  'too_large',
  'forbidden',
  'offline',
]);

function isRestoreCode(code: string): code is RestoreErrorCode {
  return RESTORE_CODES.has(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSummary(value: unknown): BackupSummary | null {
  if (!isRecord(value)) return null;
  const { createdAt, schemaVersion, members, proposals, users, photos, hasCurrent } = value;
  if (typeof createdAt !== 'string' || typeof hasCurrent !== 'boolean') return null;
  if (
    typeof schemaVersion !== 'number' ||
    typeof members !== 'number' ||
    typeof proposals !== 'number' ||
    typeof users !== 'number' ||
    typeof photos !== 'number'
  ) {
    return null;
  }
  return { createdAt, schemaVersion, members, proposals, users, photos, hasCurrent };
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Dry-run or apply a backup archive. The server replaces the whole database, including an empty one. */
export async function postRestore(
  mode: 'dry-run' | 'apply',
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/admin/restore?mode=${mode}`, {
      method: 'POST',
      body: file,
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, code: 'offline' };
  }
  if (response.status === 413) return { ok: false, code: 'too_large' };
  if (response.status === 401 || response.status === 403) return { ok: false, code: 'forbidden' };
  const body = await readBody(response);
  if (response.status === 200) {
    const summary = isRecord(body) ? readSummary(body.summary) : null;
    return summary === null ? { ok: false, code: 'restore_failed' } : { ok: true, summary };
  }
  if (response.status === 422 && isRecord(body) && typeof body.error === 'string' && isRestoreCode(body.error)) {
    return { ok: false, code: body.error };
  }
  return { ok: false, code: 'restore_failed' };
}
