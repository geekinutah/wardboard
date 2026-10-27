import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_PHOTO_BYTES } from './limit.ts';
import { sanitizePhoto } from './sanitize.ts';
import type { PhotoStore } from './store.ts';

const COLLECTION = '/api/photos';
const ITEM_PREFIX = '/api/photos/';

export type PhotoRequest = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  photos: PhotoStore;
  appOrigin: string;
  listenOrigin: string;
};

type UploadResult = { ok: true; bytes: Buffer } | { ok: false; code: 'too_large' };

function sendJson(
  res: ServerResponse,
  status: number,
  body: string,
  method: string,
  extra?: Readonly<Record<string, string>>,
): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    ...(extra ?? {}),
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  method: string,
  extra: Readonly<Record<string, string>>,
): void {
  res.writeHead(status, {
    ...extra,
    'content-length': String(body.byteLength),
    'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function sendTooLarge(req: IncomingMessage, res: ServerResponse): void {
  const payload = Buffer.from('{"error":"too_large"}');
  res.writeHead(413, {
    'content-type': 'application/json',
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
    connection: 'close',
  });
  res.end(payload, () => {
    req.on('error', () => undefined);
    req.destroy();
  });
}

function originAllowed(header: string | string[] | undefined, appOrigin: string, listenOrigin: string): boolean {
  if (typeof header !== 'string' || header.length === 0) return false;
  return header === appOrigin || header === listenOrigin;
}

function contentTypeOf(req: IncomingMessage): string {
  const value = req.headers['content-type'];
  return typeof value === 'string' ? value : '';
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

function readUpload(req: IncomingMessage, max: number): Promise<UploadResult> {
  if (overDeclaredLength(req.headers['content-length'], max)) {
    return Promise.resolve({ ok: false, code: 'too_large' });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const stop = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const finish = (result: UploadResult): void => {
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
        finish({ ok: false, code: 'too_large' });
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

async function handleUpload(
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

  const upload = await readUpload(req, MAX_PHOTO_BYTES);
  if (!upload.ok) {
    sendTooLarge(req, res);
    return;
  }

  const sanitized = sanitizePhoto(upload.bytes, contentTypeOf(req));
  if (!sanitized.ok) {
    if (sanitized.code === 'unsupported_type') {
      sendJson(res, 415, '{"error":"unsupported_type"}', method);
      return;
    }
    sendJson(res, 400, '{"error":"invalid_image"}', method);
    return;
  }

  const ref = await photos.put(sanitized.bytes, sanitized.ext);
  sendJson(res, 201, JSON.stringify({ photoRef: ref }), method);
}

export async function handlePhotoRequest(input: PhotoRequest): Promise<void> {
  const { req, res, method, pathname, photos, appOrigin, listenOrigin } = input;

  if (pathname === COLLECTION) {
    if (method !== 'POST') {
      sendJson(res, 405, '{"error":"method_not_allowed"}', method, { allow: 'POST' });
      return;
    }
    await handleUpload(req, res, method, photos, appOrigin, listenOrigin);
    return;
  }

  if (!pathname.startsWith(ITEM_PREFIX)) {
    sendJson(res, 404, '{"error":"not_found"}', method);
    return;
  }

  const ref = pathname.slice(ITEM_PREFIX.length);
  if (ref.length === 0 || ref.includes('/')) {
    sendJson(res, 404, '{"error":"not_found"}', method);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, '{"error":"method_not_allowed"}', method, { allow: 'GET, HEAD' });
    return;
  }

  const found = await photos.read(ref);
  if (found === null) {
    sendJson(res, 404, '{"error":"not_found"}', method);
    return;
  }
  sendBytes(res, 200, found.bytes, method, {
    'content-type': found.contentType,
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'private, max-age=31536000, immutable',
  });
}
