import { expect, test } from '@playwright/test';

test('preview index loads behind the gate and the app root is unchanged', async ({ page }) => {
  await page.goto('/__preview');
  await expect(page.getByRole('heading', { name: 'Previews', level: 1 })).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('banner')).toContainText('WardBoard');
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();
});
