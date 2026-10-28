import { expect, test } from '@playwright/test';

test("open the fixture proposal's summary and download the CSV", async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

  // Current board is open initially; verify no Summary button on Current
  await expect(page.getByRole('button', { name: 'Summary' })).toHaveCount(0);

  // Switch to the fixture proposal
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');

  // Summary button appears on proposal
  const summaryButton = page.getByRole('button', { name: 'Summary' });
  await expect(summaryButton).toBeVisible();
  await summaryButton.click();

  // Summary page is open
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  const backButton = page.getByRole('button', { name: '← Back to board' });
  await expect(backButton).toBeVisible();

  // Download the CSV
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.csv$/i);

  // Exit returns to the board
  await backButton.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toHaveCount(0);
  await expect(page.locator('.wb-canvas-level')).toBeVisible();
});
