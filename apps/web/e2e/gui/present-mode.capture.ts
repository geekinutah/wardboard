import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'present-mode';

const SEARCH = 'Search people, callings, tags';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('present the fixture proposal', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/?layout=desktop');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with its baseline')).toBeVisible();

  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.wb-presentation')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit presentation' })).toBeVisible();
  // No editing chrome, no notes.
  await expect(page.locator('.shell-header')).toHaveCount(0);
  await expect(page.locator('.shell-status-strip')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveCount(0);
  await expect(page.getByText('Travels for work most weekdays in March.')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await shot('presenting-proposal');

  // Exit with the keyboard and capture the restored board.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: SEARCH })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalOverflow(page);
  await shot('after-exit');
});
