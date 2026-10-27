import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fixtureIdentityProvider,
  startServer,
  type Config,
  type RunningServer,
  type StartServerOptions,
} from '../src/index.ts';

const open: RunningServer[] = [];
const tempDirs: string[] = [];

const testIdentity: StartServerOptions = {
  identityProvider: fixtureIdentityProvider({
    login: 'tester@example.test',
    displayName: 'Tester',
  }),
};

afterEach(async () => {
  const servers = open.splice(0);
  for (const server of servers) {
    await server.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function loopbackConfig(dataDir: string, webDir?: string): Config {
  const config: Config = {
    dataDir,
    baseUrl: 'http://wardboard.example',
    port: 0,
    host: '127.0.0.1',
  };
  if (webDir === undefined) return config;
  return { ...config, webDir };
}

async function start(config: Config, options?: StartServerOptions): Promise<RunningServer> {
  const running = await startServer(config, options);
  open.push(running);
  return running;
}

function rawRequest(
  baseUrl: string,
  requestPath: string,
): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: requestPath,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('startServer', () => {
  it('startServer binds an ephemeral port on loopback', async () => {
    const parent = await makeTemp('wardboard-bind-');
    const running = await start(loopbackConfig(path.join(parent, 'data')));

    expect(running.port).toBeGreaterThan(0);
    const url = new URL(running.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe(String(running.port));

    const health = await fetch(`${running.url}/api/health`);
    expect(health.status).toBe(200);
  });

  it('startServer creates a missing data dir', async () => {
    const parent = await makeTemp('wardboard-data-');
    const dataDir = path.join(parent, 'nested', 'ward', 'data');
    expect(existsSync(dataDir)).toBe(false);

    await start(loopbackConfig(dataDir));

    expect(existsSync(dataDir)).toBe(true);
    expect((await stat(dataDir)).isDirectory()).toBe(true);
  });

  it('health returns ok JSON', async () => {
    const parent = await makeTemp('wardboard-health-');
    const running = await start(loopbackConfig(path.join(parent, 'data')));

    const res = await fetch(`${running.url}/api/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('health HEAD returns 200 and other methods 405', async () => {
    const parent = await makeTemp('wardboard-head-');
    const running = await start(loopbackConfig(path.join(parent, 'data')));

    const head = await fetch(`${running.url}/api/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('x-content-type-options')).toBe('nosniff');

    const post = await fetch(`${running.url}/api/health`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect(post.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('unknown api path is a JSON 404', async () => {
    const parent = await makeTemp('wardboard-api-');
    const webDir = path.join(parent, 'web');
    await mkdir(webDir, { recursive: true });
    await writeFile(path.join(webDir, 'index.html'), '<p>spa-index-marker</p>');
    const running = await start(loopbackConfig(path.join(parent, 'data'), webDir), testIdentity);

    const res = await fetch(`${running.url}/api/nope`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('{"error":"not_found"}');
  });

  it('serves web files with content types', async () => {
    const parent = await makeTemp('wardboard-files-');
    const webDir = path.join(parent, 'web');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const woff = Buffer.from('woff2-fiction');
    await mkdir(path.join(webDir, 'assets'), { recursive: true });
    await writeFile(path.join(webDir, 'index.html'), '<p>Fictional ward</p>');
    await writeFile(path.join(webDir, 'assets', 'app.js'), 'console.log("fiction")');
    await writeFile(path.join(webDir, 'assets', 'app.css'), 'body{color:black}');
    await writeFile(path.join(webDir, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await writeFile(path.join(webDir, 'assets', 'mark.png'), png);
    await writeFile(path.join(webDir, 'assets', 'font.woff2'), woff);
    await writeFile(path.join(webDir, 'assets', 'meta.json'), '{"fiction":true}');
    const running = await start(loopbackConfig(path.join(parent, 'data'), webDir), testIdentity);

    const html = await fetch(`${running.url}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await html.text()).toBe('<p>Fictional ward</p>');

    const js = await fetch(`${running.url}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await js.text()).toBe('console.log("fiction")');

    const css = await fetch(`${running.url}/assets/app.css`);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await css.text()).toBe('body{color:black}');

    const svg = await fetch(`${running.url}/assets/icon.svg`);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(await svg.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const image = await fetch(`${running.url}/assets/mark.png`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).equals(png)).toBe(true);

    const font = await fetch(`${running.url}/assets/font.woff2`);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(Buffer.from(await font.arrayBuffer()).equals(woff)).toBe(true);

    const json = await fetch(`${running.url}/assets/meta.json`);
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(await json.text()).toBe('{"fiction":true}');
  });

  it('spa fallback serves index.html', async () => {
    const parent = await makeTemp('wardboard-spa-');
    const webDir = path.join(parent, 'web');
    await mkdir(webDir, { recursive: true });
    await writeFile(path.join(webDir, 'index.html'), '<p>spa-index-marker</p>');
    const running = await start(loopbackConfig(path.join(parent, 'data'), webDir), testIdentity);

    const res = await fetch(`${running.url}/board/123`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<p>spa-index-marker</p>');
  });

  it('path traversal never escapes webDir', async () => {
    const parent = await makeTemp('wardboard-escape-');
    const webDir = path.join(parent, 'web');
    const secret = 'fiction-secret-marker';
    await mkdir(path.join(webDir, 'assets'), { recursive: true });
    await writeFile(path.join(webDir, 'index.html'), '<p>spa-index-marker</p>');
    await writeFile(path.join(parent, 'secret.txt'), secret);
    const running = await start(loopbackConfig(path.join(parent, 'data'), webDir), testIdentity);

    // fetch() applies WHATWG URL rules and rewrites dot-segments, %2e%2e, and
    // backslashes before the bytes leave the client. /..%2f survives fetch;
    // the other contract paths are sent with node:http's raw request target.
    const viaFetch = await fetch(`${running.url}/..%2fsecret.txt`);
    const viaFetchBody = await viaFetch.text();
    expect(viaFetch.status).toBe(404);
    expect(viaFetchBody).not.toContain(secret);
    expect(viaFetchBody).not.toContain('spa-index-marker');

    const attacks = ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..\\..\\secret.txt'];
    for (const attack of attacks) {
      const result = await rawRequest(running.url, attack);
      expect(result.status, attack).toBe(404);
      expect(result.body, attack).not.toContain(secret);
      expect(result.body, attack).not.toContain('spa-index-marker');
    }
  });

  it('no webDir means non-api 404', async () => {
    const parent = await makeTemp('wardboard-noweb-');
    const running = await start(loopbackConfig(path.join(parent, 'data')), testIdentity);

    const res = await fetch(`${running.url}/`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"error":"not_found"}');
  });

  it('close stops the server', async () => {
    const parent = await makeTemp('wardboard-close-');
    const running = await start(loopbackConfig(path.join(parent, 'data')));
    const before = await fetch(`${running.url}/api/health`);
    expect(before.status).toBe(200);

    await running.close();

    await expect(fetch(`${running.url}/api/health`)).rejects.toThrow();
  });
});
