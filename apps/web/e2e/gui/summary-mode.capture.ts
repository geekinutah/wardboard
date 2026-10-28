import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'summary-mode';

test('summary-mode', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

  // Switch to the fixture proposal
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');

  // Open Summary
  await page.getByRole('button', { name: 'Summary' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();

  // Project names are `<viewport>-<browser>` (docs/gui-verification.md).
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
