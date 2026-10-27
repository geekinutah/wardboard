import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'preview';

test('preview index', async ({ page }, testInfo) => {
  await page.goto('/__preview');
  await expect(page.getByRole('heading', { name: 'Previews', level: 1 })).toBeVisible();
  await expect(page.getByText('No previews yet.')).toBeVisible();

  // Compare against the root element's clientWidth to detect horizontal overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // Project names are `<viewport>-<browser>` (docs/gui-verification.md).
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
