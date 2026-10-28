import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('shows removed items, net changes, and blocked Accept button on the preview', async ({ page }) => {
  await page.goto('/__preview/phone-changes');

  await expect(page.getByRole('heading', { level: 1, name: 'Changes' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Removed from Current · 2' })).toBeVisible();
  await expect(page.getByText('Flo Madeup')).toBeVisible();
  await expect(page.getByText('REMOVED', { exact: true })).toBeVisible();
  await expect(page.getByText('POSITION REMOVED', { exact: true })).toBeVisible();

  await expect(page.getByText('Suggested callings')).toBeVisible();
  await expect(page.getByText('Suggested releases')).toBeVisible();
  await expect(page.getByText('Position changes')).toBeVisible();
  await expect(page.getByText('Resolve the 2 removed items to accept')).toBeVisible();

  const acceptBtn = page.getByRole('button', { name: 'Accept proposal' });
  await expect(acceptBtn).toBeVisible();
  await expect(acceptBtn).toBeDisabled();

  // Suggested callings is open by default: Ivy Notreal is visible
  await expect(page.getByText('Ivy Notreal')).toBeVisible();

  // Expanding Suggested releases reveals Ari Sample
  const releasesSummary = page.getByText('Suggested releases');
  await releasesSummary.click();
  await expect(page.getByText('Ari Sample')).toBeVisible();

  await expectNoHorizontalOverflow(page);
});

test('switching to an eligible proposal enables Accept proposal', async ({ page }) => {
  await page.goto('/__preview/phone-changes');

  // Open the board switcher
  const switcherBtn = page.getByRole('button', { name: /Switch board/i });
  await switcherBtn.click();

  const dialog = page.getByRole('dialog', { name: 'Boards' });
  await expect(dialog).toBeVisible();

  // Pick Clean proposal
  await dialog.getByRole('button', { name: /Clean proposal/ }).click();
  await expect(dialog).not.toBeVisible();

  const acceptBtn = page.getByRole('button', { name: 'Accept proposal' });
  await expect(acceptBtn).toBeVisible();
  await expect(acceptBtn).toBeEnabled();

  await acceptBtn.click();
  await expect(page.getByText('Accepted · read-only')).toBeVisible();

  const reopenBtn = page.getByRole('button', { name: 'Return to Draft' });
  await expect(reopenBtn).toBeVisible();
  await reopenBtn.click();

  await expect(page.getByRole('button', { name: 'Accept proposal' })).toBeVisible();
});
