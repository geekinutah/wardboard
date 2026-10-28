import { expect, test } from '@playwright/test';

test('duplicate a proposal from the read-only bar', async ({ page }) => {
  await page.goto('/__preview/proposals');
  await expect(page.getByText('Read-only · imported Oct 24, 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Start proposal' }).click();
  await page.getByRole('radio', { name: 'Duplicate “Youth focus”' }).check();
  await page.getByRole('textbox', { name: 'Name' }).fill('Primary staffing');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Created “Primary staffing” as a duplicate of “Youth focus”');
});

test('Escape closes the dialog without creating', async ({ page }) => {
  await page.goto('/__preview/proposals');
  await page.getByRole('button', { name: 'Start proposal' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a proposal' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
});
