import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const link = page.getByRole('banner').getByRole('link', { name: 'Settings' });
  await expect(link).toBeVisible();
  // Mark the document so a full reload (which would drop the socket) is detectable.
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
  await link.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

test('open Settings, invite a login, see it listed as Invited, revoke it', async ({ page }, testInfo) => {
  const login = `t080-${testInfo.project.name}@example.test`;
  await openSettings(page);

  // The signed-in fictional admin is listed from listAccess.
  await expect(page.locator('.wb-settings-row', { hasText: 'e2e-editor@example.test' })).toBeVisible();

  await page.getByLabel('Login to invite').click();
  await page.keyboard.type(login);
  await page.getByRole('button', { name: 'Invite editor' }).click();

  const row = page.locator('.wb-settings-row', { hasText: login });
  await expect(row).toBeVisible();
  await expect(row.getByText('Invited')).toBeVisible();

  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toHaveCount(0);

  // Back to board returns to / without a reload.
  await page.getByRole('button', { name: '← Back to board' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('banner')).toContainText('WardBoard');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test('backup download returns an archive', async ({ page }) => {
  await openSettings(page);

  const response = await page.request.get('/api/admin/backup');
  expect(response.status()).toBe(200);
  expect((await response.body()).byteLength).toBeGreaterThan(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Create backup' }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  const bytes = await readFile(filePath);
  expect(bytes.byteLength).toBeGreaterThan(0);
});

test('browser back from /settings shows the board', async ({ page }) => {
  await openSettings(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('banner')).toContainText('WardBoard');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toHaveCount(0);
});
