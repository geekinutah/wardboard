import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('phone search preview lists results and adds a member to the dugout', async ({ page }) => {
  await page.goto('/__preview/phone-search');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // People and Callings headings visible with initialQuery="a"
  await expect(page.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Callings' })).toBeVisible();

  // Find Ada Fictional row and add to dugout
  const addBtn = page.getByRole('button', { name: 'Add Ada Fictional to dugout' });
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // Status message and row updates to "In dugout"
  await expect(page.getByText('Added Ada Fictional to dugout')).toBeVisible();
  const adaRow = page.locator('.wb-phone-search-row').filter({ hasText: 'Ada Fictional' });
  await expect(adaRow.getByText('In dugout')).toBeVisible();
  await expect(adaRow.getByRole('button', { name: 'Add Ada Fictional to dugout' })).toHaveCount(0);

  // Shell dugout tab count increments or shows
  await expect(page.getByRole('navigation', { name: 'Board sections' })).toBeVisible();

  await expectNoHorizontalOverflow(page);
});

test('phone dugout preview filters by Youth and triggers Place', async ({ page }) => {
  await page.goto('/__preview/phone-dugout');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Jo Testwell explicit inclusion has "Placed here · still"
  await expect(page.getByText(/Placed here · still/)).toBeVisible();

  // Filter by Youth
  const youthChip = page.getByRole('button', { name: /Youth/ });
  await youthChip.click();

  // Tai Demo remains and adult rows disappear
  await expect(page.getByText('Tai Demo')).toBeVisible();
  await expect(page.getByText(/Placed here · still/)).toHaveCount(0);
  await expect(page.getByText('Jay Storybook')).toHaveCount(0);

  // Trigger Place
  const placeBtn = page.getByRole('button', { name: 'Place Tai Demo' });
  await expect(placeBtn).toBeVisible();
  await placeBtn.click();

  // Status appears
  await expect(page.getByText('Place Tai Demo')).toBeVisible();

  await expectNoHorizontalOverflow(page);
});
