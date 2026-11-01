import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { uniqueProposalName } from './support/proposals.ts';

/*
 * T-095: Search and Dugout on the live phone app. Current stays read-only.
 * The draft this file creates is the only board it edits. Its name must not
 * contain "current" (B-074 matches that word in the desktop start-proposal spec).
 */

const SKIP_REASON = 'Phone search and dugout apply to the phone projects';

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

async function openCurrent(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
}

async function startProposal(page: Page, name: string): Promise<void> {
  await openCurrent(page);
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Primary,/ })).toBeVisible();
}

function sections(page: Page) {
  return page.getByRole('navigation', { name: 'Board sections' });
}

test('search, dugout, and changes on the live phone', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await openCurrent(page);
  const nav = sections(page);

  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search' });
  await expect(search).toBeVisible();
  await expect(page.getByText('Type a name, calling, or tag, or choose a filter.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Use desktop layout' })).toHaveCount(0);

  await search.click();
  await page.keyboard.type('Bea');
  await page.getByRole('button', { name: /^Bea Placeholder/ }).click();
  const sheet = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(sheet).toContainText('Callings in Current');
  await expect(sheet.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await expect(search).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(search).toBeVisible();

  await search.fill('Primary Teacher');
  await page.getByRole('button', { name: /^Primary Teacher(?!s)/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);

  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('Nursery');
  await page.getByRole('button', { name: /^Nursery.*Group ·/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Nursery/ })).toBeVisible();

  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('Musical');
  await page.getByRole('button', { name: /^Musical/ }).click();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tag: Musical/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await nav.getByRole('button', { name: /^Dugout · / }).click();
  await expect(
    page.getByText('No calling in this proposal, or placed here on purpose. Not a measure of availability.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Place / })).toHaveCount(0);

  await nav.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(
    page.getByText('Current is the baseline reference board and has no proposed changes.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Use desktop layout' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('a draft can add to the dugout and place from it', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  const name = uniqueProposalName('Phone search', testInfo);
  await startProposal(page, name);
  const nav = sections(page);

  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search' });
  await search.click();
  await page.keyboard.type('Bea');
  await page.getByRole('button', { name: 'Add Bea Placeholder to dugout' }).click();
  await expect(page.getByRole('dialog', { name: /^Bea Placeholder/ })).toHaveCount(0);
  const bea = page.locator('.wb-phone-search-row').filter({ hasText: 'Bea Placeholder' });
  await expect(bea.getByText('In dugout')).toBeVisible();

  await page.getByRole('button', { name: /^Bea Placeholder/ }).click();
  const sheet = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(sheet).toContainText(`Callings in ${name}`);
  await expect(sheet.getByRole('button', { name: 'Move from Primary Teacher' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(search).toBeVisible();

  await nav.getByRole('button', { name: /^Dugout · / }).click();
  await page.getByRole('button', { name: 'Place Jay Storybook' }).click();
  const jay = page.getByRole('dialog', { name: /^Jay Storybook/ });
  await expect(jay.getByRole('button', { name: 'Assign calling…' })).toBeVisible();
  await jay.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Place Jay Storybook' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
