import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Config } from './config.ts';

export type RunningServer = {
  url: string;
  port: number;
  close(): Promise<void>;
};

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const closers = new WeakMap<Server, Promise<void>>();

type OpenResult = 'missing' | 'not-file' | 'escape' | { filePath: string };

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isFile(result: OpenResult): result is { filePath: string } {
  return typeof result === 'object';
}

/**
 * Decode the raw request target and resolve it under webDir.
 * `path.join` would let `..`, `%2e%2e`, `%2f`, or `\` escape the directory.
 */
function locateInsideWebDir(webDir: string, rawPath: string): { kind: 'inside'; filePath: string } | { kind: 'escape' } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath.replaceAll('\\', '/'));
  } catch {
    return { kind: 'escape' };
  }
  decoded = decoded.replaceAll('\\', '/');
  if (decoded.includes('\0')) return { kind: 'escape' };

  const relative = decoded.replace(/^\/+/, '');
  const segments = relative.split('/');
  if (segments.some((segment) => path.posix.isAbsolute(segment) || path.win32.isAbsolute(segment))) {
    return { kind: 'escape' };
  }

  const root = path.resolve(webDir);
  const candidate = path.resolve(root, relative);
  if (!isContained(root, candidate)) return { kind: 'escape' };
  return { kind: 'inside', filePath: candidate };
}

async function openInside(webDir: string, candidate: string): Promise<OpenResult> {
  let rootReal: string;
  try {
    rootReal = await realpath(webDir);
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return 'missing';
    throw error;
  }

  let fileReal: string;
  try {
    fileReal = await realpath(candidate);
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return 'missing';
    throw error;
  }

  if (!isContained(rootReal, fileReal)) return 'escape';
  const info = await stat(fileReal);
  if (!info.isFile()) return 'not-file';
  return { filePath: fileReal };
}

function writeResponse(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Readonly<Record<string, string>>,
  method: string,
): void {
  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, {
    ...headers,
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: string,
  method: string,
  extra?: Readonly<Record<string, string>>,
): void {
  writeResponse(res, status, body, extra === undefined ? JSON_HEADERS : { ...JSON_HEADERS, ...extra }, method);
}

async function sendFile(res: ServerResponse, method: string, filePath: string, typePath: string): Promise<void> {
  const body = await readFile(filePath);
  writeResponse(res, 200, body, { 'content-type': contentTypeFor(typePath) }, method);
}

function requestPath(url: string): string {
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

async function serveWeb(
  res: ServerResponse,
  method: string,
  webDir: string,
  rawPath: string,
): Promise<void> {
  const located = locateInsideWebDir(webDir, rawPath);
  if (located.kind === 'escape') {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }

  const opened = await openInside(webDir, located.filePath);
  if (opened === 'escape') {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }
  if (isFile(opened)) {
    await sendFile(res, method, opened.filePath, located.filePath);
    return;
  }

  const indexPath = path.resolve(webDir, 'index.html');
  const index = await openInside(webDir, indexPath);
  if (index === 'escape' || !isFile(index)) {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }
  await sendFile(res, method, index.filePath, indexPath);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  // T-021 adds the identity middleware in front of everything else.
  // /api/health remains the only unauthenticated route.
  const method = req.method ?? 'GET';
  if (req.url === undefined) {
    writeJson(res, 400, '{"error":"bad_request"}', method);
    return;
  }
  const pathname = requestPath(req.url);

  if (pathname === '/api/health') {
    if (method === 'GET' || method === 'HEAD') {
      writeJson(res, 200, '{"status":"ok"}', method);
      return;
    }
    writeJson(res, 405, '{"error":"method_not_allowed"}', method, { allow: 'GET, HEAD' });
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }

  if (config.webDir === undefined) {
    writeJson(res, 404, '{"error":"not_found"}', method);
    return;
  }

  await serveWeb(res, method, config.webDir, pathname);
}

function formatListenUrl(host: string, port: number): string {
  const hostname = host.includes(':') ? `[${host}]` : host;
  return `http://${hostname}:${String(port)}`;
}

function closeServer(server: Server): Promise<void> {
  const existing = closers.get(server);
  if (existing !== undefined) return existing;
  const closing = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
  closers.set(server, closing);
  return closing;
}

export async function startServer(config: Config): Promise<RunningServer> {
  await mkdir(config.dataDir, { recursive: true });

  const server = createServer((req, res) => {
    void handleRequest(req, res, config).catch(() => {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      writeJson(res, 500, '{"error":"internal_error"}', req.method ?? 'GET');
    });
  });

  server.on('clientError', (_error, socket) => {
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n');
  });
  // Keep a listener so a late socket error cannot crash the process. Do not log request data.
  server.on('error', () => undefined);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Server did not bind a TCP port');
  }

  return {
    port: address.port,
    url: formatListenUrl(address.address, address.port),
    close: () => closeServer(server),
  };
}
