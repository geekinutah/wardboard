import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startCheckoutServer, type CheckoutServer } from './checkout-server.ts';

const REPORTS = path.resolve(import.meta.dirname, '../../../fixtures/lcr-reports');

test.describe.configure({ mode: 'serial' });

let server: CheckoutServer;

// The first import creates Current, so this spec runs against its own server with no Current.
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

test('with no Current the app opens the import workflow and the first import creates Current', async ({ page, browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'First import runs on one desktop and one phone engine',
  );
  const phone = testInfo.project.name === 'phone-chromium';
  const checkOverflow = async (): Promise<void> => {
    if (phone) await expectNoHorizontalOverflow(page);
  };

  // A second page opened before the import must also leave the setup page without a reload.
  let watcher: Page | null = null;
  if (!phone) {
    watcher = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await watcher.goto(`${server.url}/`);
    await expect(watcher.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeVisible();
  }

  await page.goto(`${server.url}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeVisible();
  await expect(page.getByLabel('Organizations and callings')).toBeVisible();
  await expect(page.getByLabel('Members without callings')).toBeVisible();
  await expect(page.getByLabel('Out-of-unit callings')).toBeVisible();
  await expect(page.getByLabel('Member list')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Boards' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Board sections' })).toHaveCount(0);
  await checkOverflow();

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await page.getByLabel('Member list').setInputFiles(path.join(REPORTS, 'member-list.pdf'));
  await expect(page.getByText('out-of-unit-callings.pdf')).toBeVisible();
  await checkOverflow();
  await page.getByRole('button', { name: 'Preview import' }).click();

  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await checkOverflow();

  // Resolve every row the preview asks about with real clicks.
  const rows = page.locator('.wb-import-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.getByRole('button', { name: 'Adult', exact: true }).click();
  }
  const replace = page.getByRole('button', { name: 'Replace Current' });
  await expect(replace).toBeEnabled();
  await replace.click();

  // The setup page gives way to the board without a reload.
  await expect(page.getByRole('heading', { name: 'Set up WardBoard' })).toHaveCount(0);
  if (phone) {
    await expect(page.getByRole('navigation', { name: 'Board sections' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  } else {
    await expect(page.getByRole('tablist', { name: 'Boards' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Current/ })).toBeVisible();
  }
  await checkOverflow();

  if (watcher !== null) {
    await expect(watcher.getByRole('heading', { name: 'Set up WardBoard' })).toHaveCount(0);
    await expect(watcher.getByRole('tab', { name: /Current/ })).toBeVisible();
    await watcher.close();
  }
});
