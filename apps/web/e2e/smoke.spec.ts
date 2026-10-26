import { expect, test } from '@playwright/test';

test('smoke', async ({ page, baseURL }) => {
  // The checkout-scoped server is on an ephemeral 127.0.0.1 port, never a fixed one.
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('WardBoard');
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  // Compare against the root element's clientWidth, not window.innerWidth:
  // mobile-emulated Chromium widens innerWidth to the content width, so an
  // innerWidth comparison can never detect horizontal overflow there.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
