import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('opens Primary and comes back', async ({ page }) => {
  await page.goto('/__preview/phone-board');
  const primary = page.getByRole('button', { name: /^Primary,/ });
  await expect(primary).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await primary.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary', exact: true })).toBeVisible();
  await expect(page.getByText('Yara Fictional')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('.wb-phone-org').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Organizations' }).getByRole('button', { name: /^Primary,/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('add position is announced on a draft', async ({ page }) => {
  await page.goto('/__preview/phone-board');
  await page.getByRole('button', { name: /^Primary,/ }).click();
  await page.getByRole('button', { name: 'Add a position to Primary Teachers', exact: true }).click();
  await expect(page.getByText('Add position requested for Primary Teachers', { exact: true })).toBeVisible();
});
