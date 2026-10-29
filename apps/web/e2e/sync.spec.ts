import { expect, test } from '@playwright/test';

test('sync', async ({ page }) => {
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('WardBoard');
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
