import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe('Settings preview', () => {
  test('admin invites, promotes and removes access in the preview', async ({ page }) => {
    await page.goto('/__preview/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Invite eve@example.test
    const inviteInput = page.getByLabel('Login to invite');
    await inviteInput.fill('eve@example.test');
    await page.getByRole('button', { name: 'Invite editor' }).click();

    await expect(page.getByText('eve@example.test')).toBeVisible();
    await expect(page.getByText('Invited').first()).toBeVisible();

    // Make admin on Ben
    const benRow = page.locator('.wb-settings-row', { hasText: 'Ben Editor' });
    await expect(benRow).toBeVisible();
    await benRow.getByRole('button', { name: 'Make admin' }).click();
    await expect(benRow.getByText('Admin')).toBeVisible();

    // Remove access on Cy with confirmation
    const cyRow = page.locator('.wb-settings-row', { hasText: 'Cy Counselor' });
    await expect(cyRow).toBeVisible();
    await cyRow.getByRole('button', { name: 'Remove access' }).click();

    // Dialog appears
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Remove access for Cy Counselor?' })).toBeVisible();

    // Confirm removal
    await dialog.getByRole('button', { name: 'Remove access' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.wb-settings-row', { hasText: 'Cy Counselor' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('restore shows the validation summary', async ({ page }) => {
    await page.goto('/__preview/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    const fileInput = page.getByLabel('Backup file');
    await fileInput.setInputFiles({
      name: 'ward.backup',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fictional backup data'),
    });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('41 members')).toBeVisible();
    await expect(dialog.getByText('12 photos')).toBeVisible();
    await expect(dialog.getByText('2 proposals')).toBeVisible();
    await expect(dialog.getByText('3 users')).toBeVisible();
    await expect(dialog.getByText('Current from Oct 24, 2026')).toBeVisible();

    // Cancel closes it
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('View as Editor hides admin controls', async ({ page }) => {
    await page.goto('/__preview/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    // Toggle View as Editor
    await page.getByLabel('View as Editor').check();

    await expect(page.getByText('Only an Admin can manage access.')).toBeVisible();
    await expect(page.getByText('Only an Admin can create or restore backups.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite editor' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Create backup' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /Show Needs approval/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
