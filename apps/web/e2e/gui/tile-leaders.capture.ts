import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'tile-leaders';

const THREE = ['Bishopric', 'Elders Quorum', 'Relief Society', 'Young Women', 'Primary'] as const;
const NONE = ['Young Men / Aaronic Priesthood', 'Ward-wide Callings'] as const;

async function expectLeaderCounts(root: Locator, slot: string): Promise<void> {
  for (const name of THREE) {
    const tile = root.getByRole('article', { name, exact: true });
    await expect(tile).toBeVisible();
    await expect(tile.locator(slot)).toHaveCount(3);
  }
  const sundaySchool = root.getByRole('article', { name: 'Sunday School', exact: true });
  await expect(sundaySchool).toBeVisible();
  // The fixture presidency has a vacant first counselor and no second counselor seat.
  await expect(sundaySchool.locator(slot)).toHaveCount(2);
  await expect(sundaySchool.getByText('Vacant', { exact: true })).toBeVisible();
  await expect(sundaySchool.getByText('First Counselor', { exact: true })).toBeVisible();
  for (const name of NONE) {
    const tile = root.getByRole('article', { name, exact: true });
    await expect(tile).toBeVisible();
    await expect(tile.locator(slot)).toHaveCount(0);
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('tile leaders on the ward overview and in presentation', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto('/?layout=desktop');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  if (project === 'desktop-chromium') {
    const overview = page.locator('.wb-overview');
    await expect(overview).toBeVisible();
    await expectLeaderCounts(overview, '.wb-overview-leader');
    const outOfUnit = page.getByRole('article', { name: 'Out-of-Unit', exact: true });
    await expect(outOfUnit).toBeVisible();
    await expect(outOfUnit.locator('.wb-overview-leader')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, 'ward-overview-desktop-chromium.png'),
      fullPage: true,
    });
  }

  if (project === 'tv-chromium') {
    await page.getByRole('tab', { name: 'Spring adjustments' }).click();
    await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Present' }).click();
    const presentation = page.locator('.wb-presentation');
    await expect(presentation).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
    await expectLeaderCounts(presentation, '.wb-presentation-leader');
    await expect(presentation.getByRole('article', { name: 'Out-of-Unit' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, 'presentation-tv-chromium.png'),
    });
  }
});
