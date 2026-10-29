import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Records every request a collector run makes, without any help from the
 * collector:
 * - `node`: HTTP requests made from this process, seen through Node's
 *   `http.client.request.start` diagnostics channel (HTTPS requests use the
 *   same client). Playwright's `context.request` runs here.
 * - `browser`: requests made by pages in any context of any Chromium launched
 *   through `chromium.launch`, seen by a listener this observer attaches to
 *   each new context.
 * Call `stop()` when the run is over.
 */
export type RequestObserver = {
  node: string[];
  browser: string[];
  stop: () => void;
};

const HTTP_CLIENT_START = 'http.client.request.start';

export function observeRequests(): RequestObserver {
  const node: string[] = [];
  const browser: string[] = [];

  const onClientStart = (message: unknown): void => {
    const { request } = message as { request: ClientRequest };
    const host = request.getHeader('host');
    node.push(`${request.protocol}//${typeof host === 'string' ? host : request.host}${request.path}`);
  };
  subscribe(HTTP_CLIENT_START, onClientStart);

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
    browser,
    stop: () => {
      unsubscribe(HTTP_CLIENT_START, onClientStart);
      if (ownLaunch === undefined) Reflect.deleteProperty(chromium, 'launch');
      else Object.defineProperty(chromium, 'launch', ownLaunch);
    },
  };
}
