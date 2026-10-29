import { expect, test, type Page } from '@playwright/test';
import { createProposal, uniqueProposalName } from './support/proposals.ts';

/*
 * The Out-of-Unit tile and view on the integrated board, on the real checkout
 * server. The test edits only a Draft it creates itself, never Current or the
 * shared seed proposal (T-084).
 */

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('open Out-of-Unit and add Kai to the dugout', async ({ page }, testInfo) => {
  const name = uniqueProposalName('Outside', testInfo);
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();

  // The tile follows the organizations on the ward overview.
  const tile = page.getByRole('article', { name: 'Out-of-Unit' });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('2 members serving outside the ward');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Open Out-of-Unit' }).click();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await expect(page.getByRole('heading', { level: 2, name: 'Out-of-Unit' })).toBeVisible();

  const kai = page.locator('.wb-out-of-unit-view article[data-member-id]').filter({ hasText: 'Kai Fictional' });
  await expect(kai).toContainText('Stake Young Single Adult Adviser');
  await kai.getByRole('button', { name: 'Add to dugout' }).click();
  await expect(kai.getByText('In the dugout · placed here on purpose')).toBeVisible();

  const dugout = page.getByRole('complementary', { name: /^Dugout/ });
  const row = dugout.locator('article[data-member-id]').filter({ hasText: 'Kai Fictional' });
  if ((await row.count()) === 0) await dugout.getByRole('button', { name: /^Show \d+ more$/ }).click();
  await expect(row).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
