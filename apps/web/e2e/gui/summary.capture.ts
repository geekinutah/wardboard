import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'summary';

/**
 * The proposal summary page (artboard 7) on every viewport it runs on.
 * TV is out of scope for this page, so the TV project skips and captures nothing.
 */
test('summary page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tv-chromium', 'TV is out of scope for the summary page');

  await page.goto('/__preview/summary');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();

  // No horizontal scroll (a phone finding when violated).
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // Touch targets are at least 44 px tall on the phone viewport.
  if (testInfo.project.name !== 'desktop-chromium') {
    for (const selector of ['.wb-summary-back', '.wb-summary-download']) {
      const height = await page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
    }
  }

  // Project names are `<viewport>-<browser>` (docs/gui-verification.md).
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
