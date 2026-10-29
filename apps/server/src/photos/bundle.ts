import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BUNDLE_BYTES, MAX_PHOTO_BYTES } from './limit.ts';
import { originAllowed, readUpload, sendJson, sendTooLarge } from './http.ts';
import { sanitizePhoto, type SanitizeResult } from './sanitize.ts';
import type { PhotoStore } from './store.ts';

export interface PhotoBundleRequest {
  readonly manifest: {
    readonly format: 'wardboard-photo-bundle';
    readonly version: 1;
    readonly layoutVersion: string;
    readonly portraits: readonly {
      readonly name: string;
      readonly file: string;
      readonly duplicateName: boolean;
    }[];
    readonly missing: readonly {
      readonly name: string;
      readonly reason: 'none' | 'household';
    }[];
    readonly skippedHousehold: number;
  };
  /** Base64-encoded image bytes keyed by the manifest portrait `file` name (`<64-hex>.jpg` or `<64-hex>.png`). */
  readonly files: Readonly<Record<string, string>>;
}

export interface PhotoBundleResponse {
  readonly portraits: readonly {
    readonly name: string;
    readonly file: string;
    readonly photoRef: string;
    readonly duplicateName: boolean;
  }[];
  readonly missing: readonly {
    readonly name: string;
    readonly reason: 'none' | 'household';
  }[];
  readonly skippedHousehold: number;
}

const FILE_PATTERN = /^[0-9a-f]{64}\.(?:jpg|png)$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== keys.length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return false;
  }
  return true;
}

interface ValidatedBundle {
  readonly manifest: PhotoBundleRequest['manifest'];
  readonly sanitizedByFile: ReadonlyMap<string, { bytes: Uint8Array; ext: 'jpg' | 'png' }>;
}

function validateAndSanitize(body: unknown): ValidatedBundle | null {
  if (!isObject(body)) return null;
  if (!hasExactKeys(body, ['manifest', 'files'])) return null;

  const { manifest, files } = body;
  if (!isObject(manifest) || !isObject(files)) return null;

  if (!hasExactKeys(manifest, ['format', 'version', 'layoutVersion', 'portraits', 'missing', 'skippedHousehold'])) {
    return null;
  }

  if (manifest.format !== 'wardboard-photo-bundle' || manifest.version !== 1) return null;
  if (typeof manifest.layoutVersion !== 'string' || manifest.layoutVersion.trim().length === 0) return null;
  if (!Number.isInteger(manifest.skippedHousehold) || (manifest.skippedHousehold as number) < 0) return null;

  if (!Array.isArray(manifest.missing) || !Array.isArray(manifest.portraits)) return null;
  if (manifest.portraits.length > 500) return null;

  for (const item of manifest.missing) {
    if (!isObject(item)) return null;
    if (!hasExactKeys(item, ['name', 'reason'])) return null;
    if (typeof item.name !== 'string' || item.name.trim().length === 0) return null;
    if (item.reason !== 'none' && item.reason !== 'household') return null;
  }

  const referencedFiles = new Set<string>();
  for (const item of manifest.portraits) {
    if (!isObject(item)) return null;
    if (!hasExactKeys(item, ['name', 'file', 'duplicateName'])) return null;
    if (typeof item.name !== 'string' || item.name.length === 0 || item.name !== item.name.trim()) return null;
    if (typeof item.file !== 'string' || !FILE_PATTERN.test(item.file)) return null;
    if (typeof item.duplicateName !== 'boolean') return null;
    referencedFiles.add(item.file);
  }

  const fileKeys = Object.keys(files);
  if (fileKeys.length !== referencedFiles.size) return null;
  for (const key of fileKeys) {
    if (!referencedFiles.has(key)) return null;
  }

  const sanitizedByFile = new Map<string, { bytes: Uint8Array; ext: 'jpg' | 'png' }>();
  for (const file of fileKeys) {
    const base64Data = files[file];
    if (typeof base64Data !== 'string' || base64Data.length === 0 || base64Data.length % 4 !== 0) return null;
    if (!BASE64_PATTERN.test(base64Data)) return null;

    const decoded = Buffer.from(base64Data, 'base64');
    if (decoded.byteLength === 0 || decoded.byteLength > MAX_PHOTO_BYTES) return null;

    const stem = file.slice(0, 64);
    const hash = createHash('sha256').update(decoded).digest('hex');
    if (hash !== stem) return null;

    const ext: 'jpg' | 'png' = file.endsWith('.jpg') ? 'jpg' : 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
    const sanitized: SanitizeResult = sanitizePhoto(decoded, mime);
    if (!sanitized.ok || sanitized.ext !== ext) return null;

    sanitizedByFile.set(file, { bytes: sanitized.bytes, ext: sanitized.ext });
  }

  return {
    manifest: manifest as unknown as PhotoBundleRequest['manifest'],
    sanitizedByFile,
  };
}

export async function handleBundleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  photos: PhotoStore,
  appOrigin: string,
  listenOrigin: string,
): Promise<void> {
  if (!originAllowed(req.headers.origin, appOrigin, listenOrigin)) {
    sendJson(res, 403, '{"error":"forbidden"}', method, { 'cache-control': 'no-store' });
    return;
  }

  const upload = await readUpload(req, MAX_BUNDLE_BYTES);
  if (!upload.ok) {
    sendTooLarge(req, res);
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(upload.bytes.toString('utf8'));
  } catch {
    sendJson(res, 400, '{"error":"invalid_bundle"}', method);
    return;
  }

  const validated = validateAndSanitize(body);
  if (validated === null) {
    sendJson(res, 400, '{"error":"invalid_bundle"}', method);
    return;
  }

  const refByFile = new Map<string, string>();
  for (const [file, sanitized] of validated.sanitizedByFile.entries()) {
    const ref = await photos.put(sanitized.bytes, sanitized.ext);
    refByFile.set(file, ref);
  }

  const response: PhotoBundleResponse = {
    portraits: validated.manifest.portraits.map((portrait) => ({
      name: portrait.name,
      file: portrait.file,
      photoRef: refByFile.get(portrait.file) ?? '',
      duplicateName: portrait.duplicateName,
    })),
    missing: validated.manifest.missing,
    skippedHousehold: validated.manifest.skippedHousehold,
  };

  sendJson(res, 200, JSON.stringify(response), method);
}
