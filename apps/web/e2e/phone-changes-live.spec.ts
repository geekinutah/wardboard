import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { uniqueProposalName } from './support/proposals.ts';

/*
 * T-096: Changes on the live phone app. Current stays a baseline with nothing
 * to accept. The draft this file creates is the only proposal it accepts.
 * Its name must not contain "current" (B-074). Do not accept Spring adjustments.
 */

const SKIP_REASON = 'Phone changes apply to the phone projects';

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith('phone');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

function sections(page: Page) {
  return page.getByRole('navigation', { name: 'Board sections' });
}

async function startProposal(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Primary,/ })).toBeVisible();
}

test('current changes has no proposed changes', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await sections(page).getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(
    page.getByText('Current is the baseline reference board and has no proposed changes.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept proposal' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Use desktop layout' })).toHaveCount(0);
  await expect(page.getByText("This screen isn't on phones yet.")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('a created draft accepts and returns to draft', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  const name = uniqueProposalName('Phone changes', testInfo);
  await startProposal(page, name);

  await page.getByRole('button', { name: /^Primary,/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary' })).toBeVisible();
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  await page
    .getByRole('dialog', { name: /^Bea Placeholder/ })
    .getByRole('button', { name: 'Release from Primary Teacher' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Released Bea Placeholder' })).toBeVisible();

  await sections(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(page.getByText('Bea Placeholder')).toBeVisible();
  await expect(page.getByText('Primary · Primary Teacher')).toBeVisible();
  await expect(page.getByText(/vs\. its .+ baseline/)).toBeVisible();
  const accept = page.getByRole('button', { name: 'Accept proposal' });
  await expect(accept).toBeEnabled();
  await accept.click();

  await expect(page.getByText('Accepted · read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept proposal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to Draft' }).click();
  await expect(page.getByRole('button', { name: 'Accept proposal' })).toBeVisible();
  await expect(page.getByText('Accepted · read-only')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
