import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('person sheet opens Move sheet and moves Jo Testwell into a vacant calling', async ({ page }) => {
  await page.goto('/__preview/phone-person');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const personDialog = page.getByRole('dialog', { name: /Jo Testwell/ });
  await expect(personDialog).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const moveBtn = personDialog.getByRole('button', { name: 'Move from Nursery Leader' });
  await expect(moveBtn).toBeVisible();
  await moveBtn.click();

  const moveDialog = page.getByRole('dialog', { name: 'Move Jo Testwell' });
  await expect(moveDialog).toBeVisible();
  await expect(moveDialog.getByText('Matches Teaches well').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const destBtn = moveDialog.getByRole('button', { name: /Primary Teacher/ });
  await expect(destBtn).toBeVisible();
  await destBtn.click();

  await expect(moveDialog).toHaveCount(0);
  const status = page.locator('.wb-phone-board-status');
  await expect(status).toHaveText('Moved Jo Testwell');
  await expectNoHorizontalOverflow(page);
});

test('releasing a calling from the person sheet updates the board', async ({ page }) => {
  await page.goto('/__preview/phone-person');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const personDialog = page.getByRole('dialog', { name: /Jo Testwell/ });
  await expect(personDialog).toBeVisible();

  const releaseBtn = personDialog.getByRole('button', { name: 'Release from Nursery Leader' });
  await expect(releaseBtn).toBeVisible();
  await releaseBtn.click();

  const status = page.locator('.wb-phone-board-status');
  await expect(status).toHaveText('Released Jo Testwell');
  await expectNoHorizontalOverflow(page);
});
