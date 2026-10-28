import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'accepted';

/**
 * The accepted-proposal view (artboard 26): the accepted state and the Draft
 * state (reopened, blocked variant so the reasons list is visible) on desktop
 * and phone. TV is out of scope.
 */
test('accepted view', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tv-chromium', 'TV is out of scope for the accepted view');

  await page.goto('/__preview/accepted?blocked=1');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy all' })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}-accepted.png`),
    fullPage: true,
  });

  await page.getByLabel('Status').selectOption('draft');
  await expect(page.getByRole('heading', { name: "Can't accept yet" })).toBeVisible();
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}-draft.png`),
    fullPage: true,
  });
});
