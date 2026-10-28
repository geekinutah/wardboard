import { expect, test } from '@playwright/test';

test('preview shows an explicit inclusion, and Youth hides the adults', async ({ page }) => {
  await page.goto('/__preview/dugout');
  await expect(page.getByText(/Placed here · still serves as/)).toBeVisible();
  const cy = page.locator('article[data-member-id]', { hasText: 'Cy Mockup' });
  const tai = page.locator('article[data-member-id]', { hasText: 'Tai Demo' });
  await expect(cy).toBeVisible();
  await expect(tai).toBeVisible();

  await page.getByRole('button', { name: 'Youth', exact: true }).click();

  await expect(tai).toBeVisible();
  await expect(cy).toHaveCount(0);
  await expect(page.getByText(/Placed here · still serves as/)).toHaveCount(0);
});
