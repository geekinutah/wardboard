import { expect, test } from '@playwright/test';

test('switches boards through the sheet', async ({ page }) => {
  await page.goto('/__preview/phone-shell');
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();

  // Tap header button
  const headerBtn = page.getByRole('button', { name: /Switch board/i });
  await headerBtn.click();

  const dialog = page.getByRole('dialog', { name: 'Boards' });
  await expect(dialog).toBeVisible();

  // Tap Current
  await dialog.getByRole('button', { name: /Current/ }).click();
  await expect(dialog).not.toBeVisible();

  // Header shows CURRENT and Current
  const header = page.locator('header.wb-phone-shell-header');
  await expect(header).toContainText('CURRENT');
  await expect(header.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();

  // Changes tab has no count
  const nav = page.getByRole('navigation', { name: 'Board sections' });
  await expect(nav.getByRole('button', { name: 'Changes' })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Changes ·/ })).toHaveCount(0);
});

test('bottom tabs switch content and stay visible', async ({ page }) => {
  await page.goto('/__preview/phone-shell');

  const nav = page.getByRole('navigation', { name: 'Board sections' });
  await expect(nav).toBeVisible();

  // Tap Dugout
  await nav.getByRole('button', { name: /Dugout/ }).click();
  await expect(page.getByText('Dugout tab content')).toBeVisible();

  // The nav's bounding box bottom equals the viewport bottom (within 1px)
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();
  if (navBox !== null && viewportSize !== null) {
    const bottom = navBox.y + navBox.height;
    expect(Math.abs(bottom - viewportSize.height)).toBeLessThanOrEqual(1);
  }

  // and document.documentElement.scrollWidth <= innerWidth
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});
