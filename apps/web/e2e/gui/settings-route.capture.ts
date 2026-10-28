import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'settings-route';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectTargetsAtLeast44(locator: Locator): Promise<void> {
  const targets = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height, width: rect.width };
    }),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, target.name).toBeGreaterThanOrEqual(44);
    expect(target.width, target.name).toBeGreaterThanOrEqual(44);
  }
}

test('settings route on the real server', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  // 1. Board header with the Settings link in the account area.
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const link = page.getByRole('banner').getByRole('link', { name: 'Settings' });
  await expect(link).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(link);
  await shot('board-header');

  // 2. Admin settings page at /settings, opened from the header link.
  await link.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People & access', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Presentation', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backup & restore', level: 2 })).toBeVisible();
  await expect(page.locator('.wb-settings-row', { hasText: 'e2e-editor@example.test' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(page.getByRole('button'));
  await expectTargetsAtLeast44(page.getByRole('link', { name: 'Create backup' }));
  await shot('admin-page');

  // 3. Back to board.
  await page.getByRole('button', { name: '← Back to board' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Settings' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('back-to-board');
});
