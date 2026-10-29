import { defineConfig } from 'vitest/config';

// The collector tests drive a real headless Chromium against a local fictional
// directory, so they need more time than the default 5 s.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
