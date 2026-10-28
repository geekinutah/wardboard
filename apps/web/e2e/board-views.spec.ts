import { expect, test } from '@playwright/test';

test('zoom into Aaronic Priesthood and change a counselor oversight on the real server; change persists after reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  // Switch to the fixture proposal
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');

  // Double click Young Men / Aaronic Priesthood
  await page.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

  // Check AaronicView is rendered
  await expect(page.locator('.wb-aaronic')).toBeVisible();
  await expect(page.getByText('Presides by office · linked from Bishopric')).toBeVisible();

  // Find the Change button in Teachers Quorum
  const teachersSection = page.locator('.wb-aaronic-quorum').filter({ hasText: 'Teachers Quorum' });
  await teachersSection.getByRole('button', { name: 'Change' }).click();

  // Select Second Counselor
  const secondCounselorRadio = teachersSection.getByRole('radio', { name: 'Second Counselor' });
  await secondCounselorRadio.click();
  await teachersSection.getByRole('button', { name: 'Confirm' }).click();

  // Verify updated overseer text in the UI
  await expect(teachersSection.locator('.wb-aaronic-overseer')).toContainText('Second Counselor');

  // Reload page to verify persistence
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

  // Switch to proposal again
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');

  // Zoom back into Aaronic Priesthood
  await page.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

  // Verify change persisted after reload
  const reloadedTeachers = page.locator('.wb-aaronic-quorum').filter({ hasText: 'Teachers Quorum' });
  await expect(reloadedTeachers.locator('.wb-aaronic-overseer')).toContainText('Second Counselor');
});
