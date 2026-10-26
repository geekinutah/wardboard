import { defineConfig } from '@playwright/test';
import { BASE_URL_ENV, GUI_CAPTURE_ENV } from './checkout-server.ts';

// Viewports and projects follow docs/gui-verification.md exactly.
// `WARDBOARD_GUI_CAPTURE=1` (set by `gui:capture`) runs only the capture
// scenarios in e2e/gui/; otherwise the e2e suite runs and e2e/gui/ is excluded.
const capture = process.env[GUI_CAPTURE_ENV] === '1';

const phone = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
} as const;

export default defineConfig({
  testDir: '.',
  testMatch: capture ? ['gui/**/*.capture.ts'] : ['**/*.spec.ts'],
  testIgnore: capture ? [] : ['gui/**'],
  outputDir: '../test-results',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  use: {
    headless: true,
    // Set by global setup to the checkout-scoped server's ephemeral URL.
    // Workers load this config after global setup, so the value is defined there.
    ...(process.env[BASE_URL_ENV] === undefined ? {} : { baseURL: process.env[BASE_URL_ENV] }),
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone-chromium',
      use: { browserName: 'chromium', ...phone },
    },
    {
      name: 'phone-webkit',
      use: { browserName: 'webkit', ...phone },
    },
    {
      name: 'tv-chromium',
      use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } },
    },
  ],
});
