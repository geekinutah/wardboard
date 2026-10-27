import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'ward-overview';

test('ward overview preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/ward-overview');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Proposal: Spring adjustments', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current', level: 2 })).toBeVisible();

  // Verify that organization tiles are rendered
  await expect(page.locator('[data-zoom-target="org:bg-0001"]').first()).toBeVisible();

  // Compare against root element's clientWidth to detect horizontal overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // Project names are `<viewport>-<browser>` (docs/gui-verification.md)
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
