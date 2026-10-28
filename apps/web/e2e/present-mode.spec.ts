import { expect, test, type Page } from '@playwright/test';

const JAY_NOTE = 'Travels for work most weekdays in March.';

const SEARCH = 'Search people, callings, tags';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('present the fixture proposal and exit with Escape', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();
  await expect(page.getByRole('banner').getByText('WardBoard')).toBeVisible();

  // Switch to the fixture proposal, then give the camera non-initial state.
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page
    .locator('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]')
    .dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');

  // Present: the editing chrome is hidden and the presentation is shown.
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.wb-presentation')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit presentation' })).toBeVisible();
  await expect(page.locator('.shell-header')).toHaveCount(0);
  await expect(page.locator('.shell-status-strip')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveCount(0);
  // Notes never render in presentation.
  await expect(page.getByText(JAY_NOTE)).toHaveCount(0);
  if (testInfo.project.name.startsWith('phone')) {
    await expectNoHorizontalOverflow(page);
  }

  // Escape returns to the same tab with the same camera.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: SEARCH })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await expectNoHorizontalOverflow(page);
});
