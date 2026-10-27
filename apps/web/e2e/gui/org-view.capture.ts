import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'org-view';

test('organization view preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/org-view');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Verify key headings and content
  await expect(page.getByRole('heading', { name: 'Leadership' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Groups' }).first()).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  await expect(page.getByText(/Overseen by/).first()).toBeVisible();

  // Screenshot per viewport (desktop-chromium, tv-chromium, phone-chromium, phone-webkit)
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });

  // Check no horizontal scroll/overflow on documentElement
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
