import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fixtureIdentityProvider,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
  type StartServerOptions,
} from '../../src/index.ts';

const openServers: RunningServer[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  const servers = openServers.splice(0);
  for (const s of servers) {
    await s.close();
  }
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupServer(options?: StartServerOptions): Promise<{
  server: RunningServer;
  webDir: string;
}> {
  const parent = await makeTempDir('gate-test-');
  const dataDir = path.join(parent, 'data');
  const webDir = path.join(parent, 'web');
  await mkdir(webDir, { recursive: true });
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><p>WardBoard Test</p>');

  const config: Config = {
    dataDir,
    baseUrl: 'http://wardboard.example',
    port: 0,
    host: '127.0.0.1',
    webDir,
  };

  const server = await startServer(config, options);
  openServers.push(server);
  return { server, webDir };
}

function sendHttp(
  port: number,
  requestPath: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method: options?.method ?? 'GET',
        headers: options?.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: unknown) => {
          if (Buffer.isBuffer(c)) {
            chunks.push(c);
          } else if (typeof c === 'string') {
            chunks.push(Buffer.from(c));
          }
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function sendRawSocket(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(payload);
    });
    const chunks: Buffer[] = [];
    socket.on('data', (d: unknown) => {
      if (Buffer.isBuffer(d)) {
        chunks.push(d);
      } else if (typeof d === 'string') {
        chunks.push(Buffer.from(d));
      }
    });
    socket.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.on('error', reject);
  });
}

describe('identity gate', () => {
  it('health is reachable without identity', async () => {
    const { server } = await setupServer();

    const getRes = await sendHttp(server.port, '/api/health', { method: 'GET' });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toBe('{"status":"ok"}');

    const headRes = await sendHttp(server.port, '/api/health', { method: 'HEAD' });
    expect(headRes.status).toBe(200);
  });

  it('web root, spa fallback and static files are refused without identity', async () => {
    const { server } = await setupServer();

    for (const testPath of ['/', '/board/1', '/index.html']) {
      const res = await sendHttp(server.port, testPath);
      expect(res.status, testPath).toBe(401);
      expect(res.headers['content-type'], testPath).toBe('application/json');
      expect(res.headers['cache-control'], testPath).toBe('no-store');
      expect(res.body, testPath).toBe('{"error":"unauthenticated"}');
    }
  });

  it('unknown api route is 401 not 404 without identity', async () => {
    const { server } = await setupServer();

    const getRes = await sendHttp(server.port, '/api/nope', { method: 'GET' });
    expect(getRes.status).toBe(401);
    expect(getRes.headers['content-type']).toBe('application/json');
    expect(getRes.headers['cache-control']).toBe('no-store');
    expect(getRes.body).toBe('{"error":"unauthenticated"}');

    const postRes = await sendHttp(server.port, '/api/nope', { method: 'POST' });
    expect(postRes.status).toBe(401);
    expect(postRes.headers['content-type']).toBe('application/json');
    expect(postRes.headers['cache-control']).toBe('no-store');
    expect(postRes.body).toBe('{"error":"unauthenticated"}');
  });

  it('spoofed health paths are not exempt', async () => {
    const { server } = await setupServer();
    const spoofedPaths = [
      '/api/health/',
      '/api/health/../x',
      '/api/healthx',
      '/api/%68ealth',
      '//api/health',
      '/api/health%2f..',
    ];

    for (const path of spoofedPaths) {
      const res = await sendHttp(server.port, path);
      expect(res.status, path).toBe(401);
      expect(res.headers['content-type'], path).toBe('application/json');
      expect(res.headers['cache-control'], path).toBe('no-store');
      expect(res.body, path).toBe('{"error":"unauthenticated"}');
    }
  });

  it('health query string stays exempt', async () => {
    const { server } = await setupServer();
    const res = await sendHttp(server.port, '/api/health?x=1');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
  });

  it('valid tailscale headers pass the gate', async () => {
    const { server } = await setupServer();
    const headers = {
      'Tailscale-User-Login': 'alice@example.test',
      'Tailscale-User-Name': 'Alice Example',
    };

    const webRes = await sendHttp(server.port, '/', { headers });
    expect(webRes.status).toBe(200);
    expect(webRes.body).toContain('WardBoard Test');

    const unknownApiRes = await sendHttp(server.port, '/api/nope', { headers });
    expect(unknownApiRes.status).toBe(404);
    expect(unknownApiRes.body).toBe('{"error":"not_found"}');
  });

  it('malformed and duplicate login headers are refused', async () => {
    const { server } = await setupServer();

    // Comma login via sendHttp
    const commaRes = await sendHttp(server.port, '/', {
      headers: {
        'Tailscale-User-Login': 'alice@example.test, bob@example.test',
      },
    });
    expect(commaRes.status).toBe(401);
    expect(commaRes.body).toBe('{"error":"unauthenticated"}');

    // Duplicate headers via raw socket
    const rawReq = [
      'GET / HTTP/1.1',
      'Host: 127.0.0.1',
      'Tailscale-User-Login: alice@example.test',
      'Tailscale-User-Login: bob@example.test',
      'Connection: close',
      '',
      '',
    ].join('\r\n');
    const rawResponse = await sendRawSocket(server.port, rawReq);
    expect(rawResponse).toMatch(/^HTTP\/1\.1 401 /);
    expect(rawResponse).toContain('{"error":"unauthenticated"}');
  });

  it('refusal body never echoes header values', async () => {
    const { server } = await setupServer();
    const evil = 'evil<script>@x.test';
    const res = await sendHttp(server.port, '/', {
      headers: {
        'Tailscale-User-Login': evil,
      },
    });
    expect(res.status).toBe(401);
    expect(res.body).toBe('{"error":"unauthenticated"}');
    expect(res.body).not.toContain('evil');
    expect(res.body).not.toContain('<script>');
  });

  it('injected fixture provider replaces tailscale', async () => {
    const fixtureUser: Identity = {
      login: 'injected@example.test',
      displayName: 'Injected User',
    };
    const { server: serverAllowed } = await setupServer({
      identityProvider: fixtureIdentityProvider(fixtureUser),
    });

    // Injected provider allows request without any headers
    const allowedRes = await sendHttp(serverAllowed.port, '/');
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body).toContain('WardBoard Test');

    // Injected null provider refuses even with valid Tailscale headers
    const { server: serverRefused } = await setupServer({
      identityProvider: fixtureIdentityProvider(null),
    });
    const refusedRes = await sendHttp(serverRefused.port, '/', {
      headers: {
        'Tailscale-User-Login': 'alice@example.test',
      },
    });
    expect(refusedRes.status).toBe(401);
    expect(refusedRes.body).toBe('{"error":"unauthenticated"}');
  });

  it('unauthenticated websocket upgrade is refused with 401', async () => {
    const { server } = await setupServer();
    const upgradeReq = [
      'GET /ws HTTP/1.1',
      'Host: 127.0.0.1',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');

    const response = await sendRawSocket(server.port, upgradeReq);
    expect(response).toMatch(/^HTTP\/1\.1 401/);
    expect(response).toContain('{"error":"unauthenticated"}');
  });

  it('upgrade to /api/health is not exempt', async () => {
    const { server } = await setupServer();
    const upgradeReq = [
      'GET /api/health HTTP/1.1',
      'Host: 127.0.0.1',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');

    const response = await sendRawSocket(server.port, upgradeReq);
    expect(response).toMatch(/^HTTP\/1\.1 401/);
    expect(response).toContain('{"error":"unauthenticated"}');
  });

  it('authenticated upgrade gets 404 until a ws endpoint exists', async () => {
    const fixtureUser: Identity = {
      login: 'ws-tester@example.test',
      displayName: 'WS Tester',
    };
    const { server } = await setupServer({
      identityProvider: fixtureIdentityProvider(fixtureUser),
    });

    const upgradeReq = [
      'GET /ws HTTP/1.1',
      'Host: 127.0.0.1',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');

    const response = await sendRawSocket(server.port, upgradeReq);
    expect(response).toMatch(/^HTTP\/1\.1 404/);
    expect(response).toContain('{"error":"not_found"}');
  });
});
