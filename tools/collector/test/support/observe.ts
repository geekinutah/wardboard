import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Records the network activity of a collector run, without any help from the
 * collector. Three independent records:
 * - `node`: request URLs made from this process at the request layer.
 *   - `http.client.request.start` sees `node:http` and `node:https` clients,
 *     which is where Playwright's `context.request` runs.
 *   - `undici:request:create` sees the global `fetch` (undici), which does
 *     not publish on the `http` channel.
 * - `sockets`: the remote `host:port` of every TCP connection attempt from
 *   this process, seen on the `net.client.socket` channel and each socket's
 *   `connectionAttempt` event (with `connect` as a fallback). Every TCP client
 *   in Node goes through this, so it also catches clients that skip the
 *   request layer: `node:net`, `node:http2`, `node:tls`, and a `fetch` or
 *   `http` request whose request-layer channel is missed.
 * - `browser`: request URLs made by pages in any context of any Chromium
 *   launched through `chromium.launch`, seen by a listener this observer
 *   attaches to each new context.
 *
 * Not observed here: UDP (`node:dgram`), Unix-domain sockets, child processes
 * and worker threads, a browser reached through `launchPersistentContext`,
 * `connect`/`connectOverCDP`, or a second Playwright copy (`playwright-core`).
 * The source-boundary tests in `staging.test.ts` forbid the collector from
 * using any of those.
 * Call `stop()` when the run is over.
 */
export type RequestObserver = {
  node: string[];
  sockets: string[];
  browser: string[];
  stop: () => void;
};

const HTTP_CLIENT_START = 'http.client.request.start';
const UNDICI_REQUEST_CREATE = 'undici:request:create';
const NET_CLIENT_SOCKET = 'net.client.socket';

const hostPort = (address: string, port: number): string =>
  `${address.includes(':') ? `[${address}]` : address}:${String(port)}`;

export function observeRequests(): RequestObserver {
  const node: string[] = [];
  const sockets: string[] = [];
  const browser: string[] = [];

  const onClientStart = (message: unknown): void => {
    const { request } = message as { request: ClientRequest };
    const host = request.getHeader('host');
    node.push(`${request.protocol}//${typeof host === 'string' ? host : request.host}${request.path}`);
  };
  const onUndiciCreate = (message: unknown): void => {
    const { request } = message as { request: { origin: string; path: string } };
    node.push(`${request.origin}${request.path}`);
  };
  const onClientSocket = (message: unknown): void => {
    const { socket } = message as { socket: Socket };
    let attempted = false;
    socket.on('connectionAttempt', (address: string, port: number) => {
      attempted = true;
      sockets.push(hostPort(address, port));
    });
    socket.once('connect', () => {
      if (!attempted && socket.remoteAddress !== undefined && socket.remotePort !== undefined) {
        sockets.push(hostPort(socket.remoteAddress, socket.remotePort));
      }
    });
  };
  subscribe(HTTP_CLIENT_START, onClientStart);
  subscribe(UNDICI_REQUEST_CREATE, onUndiciCreate);
  subscribe(NET_CLIENT_SOCKET, onClientSocket);

  const ownLaunch = Object.getOwnPropertyDescriptor(chromium, 'launch');
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args: Parameters<typeof chromium.launch>): Promise<Browser> => {
    const launched = await launch(...args);
    const newContext = launched.newContext.bind(launched);
    launched.newContext = async (...contextArgs: Parameters<Browser['newContext']>): Promise<BrowserContext> => {
      const context = await newContext(...contextArgs);
      context.on('request', (request) => browser.push(request.url()));
      return context;
    };
    return launched;
  };

  return {
    node,
    sockets,
    browser,
    stop: () => {
      unsubscribe(HTTP_CLIENT_START, onClientStart);
      unsubscribe(UNDICI_REQUEST_CREATE, onUndiciCreate);
      unsubscribe(NET_CLIENT_SOCKET, onClientSocket);
      if (ownLaunch === undefined) Reflect.deleteProperty(chromium, 'launch');
      else Object.defineProperty(chromium, 'launch', ownLaunch);
    },
  };
}
