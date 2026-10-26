import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  startServer,
  type Config,
  type RunningServer,
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

function canBind(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => {
      resolve(false);
    });
    s.listen(0, host, () => {
      s.close(() => {
        resolve(true);
      });
    });
  });
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => {
      resolve(false);
    });
    s.listen(port, host, () => {
      s.close(() => {
        resolve(true);
      });
    });
  });
}

describe('loopback guard', () => {
  it('isLoopbackHost classification', () => {
    const loopbacks = [
      '127.0.0.1',
      '127.255.255.254',
      'localhost',
      '::1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
    ];
    for (const h of loopbacks) {
      expect(isLoopbackHost(h), `expected ${h} to be loopback`).toBe(true);
    }

    const nonLoopbacks = [
      '0.0.0.0',
      '::',
      '128.0.0.1',
      '192.168.1.5',
      '127.0.0.1.example.test',
      'localhost.example.test',
    ];
    for (const h of nonLoopbacks) {
      expect(isLoopbackHost(h), `expected ${h} to be non-loopback`).toBe(false);
    }
  });

  it('loopback hosts start without the opt-in', async () => {
    const ipv6Ok = await canBind('::1');
    if (!ipv6Ok) {
      console.log('Skipping ::1: host without IPv6 loopback detected at runtime');
    }
    const hosts = ['127.0.0.1', '127.1.2.3', 'localhost', ...(ipv6Ok ? ['::1'] : [])];

    for (const host of hosts) {
      const parent = await makeTempDir('loopback-test-');
      const config: Config = {
        dataDir: path.join(parent, 'data'),
        baseUrl: 'http://wardboard.example',
        port: 0,
        host,
      };

      const bindable = await canBind(host);
      if (!bindable) {
        // Platform cannot bind this host (e.g. 127.1.2.3 on macOS without lo0 alias).
        // Confirm startServer passed the loopback guard (rejected with EADDRNOTAVAIL, not loopback error).
        await expect(startServer(config)).rejects.toThrow(/EADDRNOTAVAIL/);
        console.log(`Skipped bind for ${host}: platform cannot bind address (EADDRNOTAVAIL)`);
        continue;
      }

      const running = await startServer(config);
      openServers.push(running);
      expect(running.port).toBeGreaterThan(0);
    }
  });

  it('non-loopback host is refused before listening', async () => {
    const parent = await makeTempDir('non-loopback-refusal-');
    // Find an unused ephemeral port
    const helperServer = createServer();
    await new Promise<void>((resolve) => helperServer.listen(0, '127.0.0.1', resolve));
    const address = helperServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 54321;
    await new Promise<void>((resolve) => helperServer.close(() => { resolve(); }));

    const config: Config = {
      dataDir: path.join(parent, 'data'),
      baseUrl: 'http://wardboard.example',
      port,
      host: '0.0.0.0',
      trustIdentityHeadersOnNonLoopback: false,
    };

    let error: Error | undefined;
    try {
      await startServer(config);
    } catch (err: unknown) {
      error = err as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK');

    // Verify nothing is listening on that port afterwards
    const portFree = await isPortFree(port, '127.0.0.1');
    expect(portFree).toBe(true);
  });

  it('non-loopback host starts with the opt-in', async () => {
    const parent = await makeTempDir('non-loopback-optin-');
    const config: Config = {
      dataDir: path.join(parent, 'data'),
      baseUrl: 'http://wardboard.example',
      port: 0,
      host: '0.0.0.0',
      trustIdentityHeadersOnNonLoopback: true,
    };

    const running = await startServer(config);
    openServers.push(running);
    expect(running.port).toBeGreaterThan(0);
  });
});
