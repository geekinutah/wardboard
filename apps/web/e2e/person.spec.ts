import { expect, test } from '@playwright/test';

const SHARED =
  'Notes are shared across Current and every proposal. They never appear on the TV or in search.';

test('inspector lists two callings; a saved note appears only in the dialog', async ({ page }) => {
  await page.goto('/__preview/person');
  await expect(page.getByRole('heading', { name: 'Jo Testwell', level: 2 })).toBeVisible();
  await expect(page.getByText('Adult', { exact: true })).toBeVisible();
  await expect(page.getByText('Serves in 2 callings', { exact: true })).toBeVisible();
  await expect(page.getByText('Relief Society Teacher', { exact: true })).toBeVisible();
  await expect(page.getByText('Relief Society Teachers · Relief Society', { exact: true })).toBeVisible();
  await expect(page.getByText('Nursery Leader', { exact: true })).toBeVisible();
  await expect(page.getByText('Nursery · Primary', { exact: true })).toBeVisible();
  await expect(page.getByText('Teaches well', { exact: true })).toBeVisible();
  await expect(page.getByText(SHARED)).toHaveCount(0);

  const note = 'Fictional planning note for Jo.';
  await page.getByRole('button', { name: 'Open notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Notes · Jo Testwell' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Note' }).fill(note);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(note)).toHaveCount(0);

  await page.getByRole('button', { name: 'Open notes' }).click();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue(note);
});

test('Add to dugout updates the dugout line', async ({ page }) => {
  await page.goto('/__preview/person');
  await page.getByRole('button', { name: 'Add to dugout' }).click();
  await expect(page.getByText('In the dugout · placed here on purpose', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to dugout' })).toHaveCount(0);
  await expect(page.getByText('Serves in 2 callings', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open notes' })).toBeVisible();
});
