import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../access/index.ts';
import type { PhotoCollection } from './job.ts';

const ROOT = '/api/admin/photo-collection';
const CONTINUE_PATH = '/api/admin/photo-collection/continue';
const CANCEL_PATH = '/api/admin/photo-collection/cancel';

export type PhotoCollectionHttpInput = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  role: Role;
  appOrigin: string;
  listenOrigin: string;
  job: PhotoCollection;
};

function sendJson(res: ServerResponse, status: number, body: string, extra?: Readonly<Record<string, string>>): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(extra ?? {}),
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function originAllowed(header: string | string[] | undefined, appOrigin: string, listenOrigin: string): boolean {
  if (typeof header !== 'string' || header.length === 0) return false;
  return header === appOrigin || header === listenOrigin;
}

export async function handlePhotoCollectionRequest(input: PhotoCollectionHttpInput): Promise<void> {
  if (input.role !== 'admin') {
    sendJson(input.res, 403, '{"error":"forbidden"}');
    return;
  }

  if (input.pathname === ROOT) {
    if (input.method !== 'GET' && input.method !== 'POST') {
      sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'GET, POST' });
      return;
    }
    if (input.method === 'GET') {
      sendJson(input.res, 200, input.job.view());
      return;
    }
    if (!originAllowed(input.req.headers.origin, input.appOrigin, input.listenOrigin)) {
      sendJson(input.res, 403, '{"error":"forbidden"}');
      return;
    }
    const result = await input.job.start();
    sendJson(input.res, result.status, result.body);
    return;
  }

  if (input.pathname === CONTINUE_PATH) {
    if (input.method !== 'POST') {
      sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'POST' });
      return;
    }
    if (!originAllowed(input.req.headers.origin, input.appOrigin, input.listenOrigin)) {
      sendJson(input.res, 403, '{"error":"forbidden"}');
      return;
    }
    const result = input.job.releaseWait();
    sendJson(input.res, result.status, result.body);
    return;
  }

  if (input.pathname === CANCEL_PATH) {
    if (input.method !== 'POST') {
      sendJson(input.res, 405, '{"error":"method_not_allowed"}', { allow: 'POST' });
      return;
    }
    if (!originAllowed(input.req.headers.origin, input.appOrigin, input.listenOrigin)) {
      sendJson(input.res, 403, '{"error":"forbidden"}');
      return;
    }
    const result = await input.job.cancel();
    sendJson(input.res, result.status, result.body);
  }
}
