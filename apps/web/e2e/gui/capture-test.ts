import { test as base } from '@playwright/test';
import { startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

type CaptureFixtures = {
  /** False starts an empty data directory. Defaults to true (fixture ward). */
  captureSeed: boolean;
  captureServer: CheckoutServer;
};

// One server per test, including each browser project. Teardown deletes its data directory.
export const test = base.extend<CaptureFixtures>({
  captureSeed: [true, { option: true }],
  captureServer: [
    async ({ captureSeed }, use) => {
      const server = await startCheckoutServer({ seed: captureSeed });
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { auto: true, scope: 'test' },
  ],
  baseURL: async ({ captureServer }, use) => {
    await use(captureServer.url);
  },
});
