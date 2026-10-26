import { expect, test } from '@playwright/test';

test('smoke', async ({ page, baseURL }) => {
  // The checkout-scoped server is on an ephemeral 127.0.0.1 port, never a fixed one.
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('WardBoard');
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});
