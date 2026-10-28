import { expect, test } from '@playwright/test';

test('preview shows summary heading and both watermark texts; no horizontal scroll', async ({ page }) => {
  await page.goto('/__preview/removed');

  await expect(page.getByRole('heading', { name: /Removed from Current since this baseline/u })).toBeVisible();
  await expect(page.getByText('REMOVED', { exact: true })).toBeVisible();
  await expect(page.getByText('POSITION REMOVED', { exact: true })).toBeVisible();

  // Compare against the root element's clientWidth to detect horizontal overflow
  // (a real finding at the phone viewport, docs/gui-verification.md).
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
