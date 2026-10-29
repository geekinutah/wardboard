import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'board-views';

test('board-views Aaronic level 2 capture', async ({ page }, testInfo) => {
  const scenarioDir = path.join(guiArtifactsDir, SCENARIO);
  await mkdir(scenarioDir, { recursive: true });

  // Note for removed summary/markers per T-076 contract
  await writeFile(
    path.join(scenarioDir, 'unit-test-only-note.txt'),
    'Removed summary and markers are covered in unit tests only because apps/web/e2e/checkout-server.ts seed seam does not support seeding removed data (per T-076 contract).\n',
    'utf-8',
  );

  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  // Switch to the fixture proposal
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');

  // Zoom into Young Men / Aaronic Priesthood
  await page.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await expect(page.locator('.wb-aaronic')).toBeVisible();

  // Capture Aaronic level 2 screenshot at project viewport
  await page.screenshot({
    path: path.join(scenarioDir, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
