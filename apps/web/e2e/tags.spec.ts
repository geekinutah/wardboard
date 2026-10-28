import { expect, test } from '@playwright/test';

/**
 * The tags and affinities preview (artboard 10). TV is out of scope: these are
 * desktop and phone editors, so the TV project skips.
 */
const isTv = (testInfo: { project: { name: string } }): boolean => testInfo.project.name === 'tv-chromium';

test('create a tag from the member editor, see it in the library, delete it with confirmation', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the tags editors');

  await page.goto('/__preview/tags');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const combobox = page.getByRole('combobox', { name: 'Add a tag' });
  await combobox.fill('Gardening');
  await page.getByRole('option', { name: 'Create tag “Gardening”' }).click();

  // The new tag is on the member and, through shared state, in the library with 1 person.
  await expect(page.getByRole('button', { name: 'Remove tag Gardening' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Gardening' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').nth(1)).toHaveText('1');

  // Delete asks first, with counts.
  await page.getByRole('button', { name: 'Delete Gardening' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Gardening”?' });
  await expect(dialog).toContainText(
    'Removes it from 1 person and from the preferences on 0 callings. Nothing else changes.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove tag Gardening' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Gardening' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete tag' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove tag Gardening' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete Gardening' })).toHaveCount(0);
});

test('preferences and calling tags edit the proposal calling; Needs approval toggles', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the tags editors');

  await page.goto('/__preview/tags');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByText('CALLING · THIS PROPOSAL ONLY')).toBeVisible();
  await page.getByRole('button', { name: '+ Preference' }).click();
  await page.getByRole('combobox', { name: 'Add a preference' }).fill('Musical');
  await page.getByRole('option', { name: /Musical/u }).click();
  await expect(page.getByRole('button', { name: 'Remove preference Musical' })).toBeVisible();

  const toggle = page.getByRole('switch', { name: 'Needs approval' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('no horizontal scroll; controls at least 44px tall (phone projects)', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the tags editors');

  await page.goto('/__preview/tags');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  if (testInfo.project.name === 'desktop-chromium') {
    return;
  }
  const heights = await page.locator('.wb-tags-preview').evaluate((root) => {
    const targets = [...root.querySelectorAll('button, .wb-tags-combobox-field')];
    return targets.map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent, height: el.getBoundingClientRect().height }));
  });
  expect(heights.length).toBeGreaterThan(5);
  for (const target of heights) {
    expect(target.height, target.label).toBeGreaterThanOrEqual(44);
  }
});
