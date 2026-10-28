import { expect, test } from '@playwright/test';

test('tile opens the view and Add to dugout updates it', async ({ page }) => {
  await page.goto('/__preview/out-of-unit');

  // Verify preview loaded
  await expect(page.getByRole('article', { name: 'Out-of-Unit' })).toBeVisible();

  // Click Open Out-of-Unit
  await page.getByRole('button', { name: 'Open Out-of-Unit' }).click();

  // The view heading is focused
  const heading = page.locator('#out-of-unit-heading');
  await expect(heading).toBeFocused();

  // Locate Kai article
  const kaiArticle = page.locator('article[data-member-id]', { hasText: 'Kai Fictional' });
  await expect(kaiArticle).toBeVisible();

  // Add to dugout button is present on Kai
  const addButton = kaiArticle.getByRole('button', { name: 'Add to dugout' });
  await expect(addButton).toBeVisible();

  // Click Add to dugout on Kai
  await addButton.click();

  // Expect "In the dugout · placed here on purpose" to be shown, and button gone
  await expect(kaiArticle.getByText('In the dugout · placed here on purpose')).toBeVisible();
  await expect(addButton).toHaveCount(0);
});
