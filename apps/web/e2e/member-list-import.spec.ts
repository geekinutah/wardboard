import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startCheckoutServer, type CheckoutServer } from './checkout-server.ts';

const REPORTS = path.resolve(import.meta.dirname, '../../../fixtures/lcr-reports');

// From the fictional fixtures (see apps/server/test/import/member-list-route.test.ts):
// 145 people hold a calling and have no Members without Callings age. The Member List
// settles all of them except its two printed namesakes, `Westdale, Gus` (also a report
// conflict) and `Fairwell, Sage Casey Kendall Reagan`, so two rows still ask.
const UNAGED_WITHOUT_MEMBER_LIST = 145;
const ROWS_WITH_MEMBER_LIST = 2;

test.describe.configure({ mode: 'serial' });

let server: CheckoutServer;

// The import creates Current, so this spec runs against its own server with no Current.
test.beforeAll(async () => {
  server = await startCheckoutServer({ seed: false });
});

test.afterAll(async () => {
  await server.stop();
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('the member list is required and settles youth and adult', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Member list import runs on one desktop and one phone engine',
  );
  const phone = testInfo.project.name === 'phone-chromium';

  await page.goto(`${server.url}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeVisible();
  const preview = page.getByRole('button', { name: 'Preview import' });
  const picker = page.getByLabel('Member list');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAccessibleDescription(
    'In LCR: Reports → Member Directory → Print → Download PDF. The printed report is titled "Member List".',
  );

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await expect(page.getByText('out-of-unit-callings.pdf')).toBeVisible();
  await expect(preview).toBeDisabled();

  await picker.setInputFiles(path.join(REPORTS, 'member-list.pdf'));
  await expect(page.getByText('member-list.pdf')).toBeVisible();
  await expect(preview).toBeEnabled();
  if (phone) await expectNoHorizontalOverflow(page);
  await preview.click();

  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  const card = page.getByRole('article', { name: 'Member list, Validated' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Validated')).toBeVisible();

  const asking = page.locator('.wb-import-row').filter({ has: page.getByRole('button', { name: 'Adult', exact: true }) });
  await expect(asking).toHaveCount(ROWS_WITH_MEMBER_LIST);
  expect(ROWS_WITH_MEMBER_LIST).toBeLessThan(UNAGED_WITHOUT_MEMBER_LIST);
  if (phone) await expectNoHorizontalOverflow(page);

  for (let index = 0; index < ROWS_WITH_MEMBER_LIST; index += 1) {
    await asking.nth(index).getByRole('button', { name: 'Adult', exact: true }).click();
  }
  const replace = page.getByRole('button', { name: 'Replace Current' });
  await expect(replace).toBeEnabled();
  await replace.click();

  await expect(page.getByRole('heading', { name: 'Set up WardBoard' })).toHaveCount(0);
  if (phone) {
    await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } else {
    await expect(page.getByRole('tab', { name: /Current/ })).toBeVisible();
  }
});
