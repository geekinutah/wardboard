import { expect, test, type Page } from '@playwright/test';
import { createProposal, uniqueProposalName } from './support/proposals.ts';

async function openProposal(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test('zoom into Aaronic Priesthood and change a counselor oversight on the real server; change persists after reload', async ({
  page,
}, testInfo) => {
  const proposalName = uniqueProposalName('Views', testInfo);
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  await createProposal(page, proposalName);
  await openProposal(page, proposalName);

  // Double click Young Men / Aaronic Priesthood
  await page.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

  // Check AaronicView is rendered
  await expect(page.locator('.wb-aaronic')).toBeVisible();
  await expect(page.getByText('Presides by office · linked from Bishopric')).toBeVisible();

  // Find the Change button in Teachers Quorum
  const teachersSection = page.locator('.wb-aaronic-quorum').filter({ hasText: 'Teachers Quorum' });
  await expect(teachersSection.locator('.wb-aaronic-overseer')).toContainText('Overseen by First Counselor');
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

  await openProposal(page, proposalName);

  // Zoom back into Aaronic Priesthood
  await page.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

  // Verify change persisted after reload
  const reloadedTeachers = page.locator('.wb-aaronic-quorum').filter({ hasText: 'Teachers Quorum' });
  await expect(reloadedTeachers.locator('.wb-aaronic-overseer')).toContainText('Second Counselor');
});
