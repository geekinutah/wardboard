import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startCheckoutServer, type CheckoutServer } from './checkout-server.ts';

const REPORTS = path.resolve(import.meta.dirname, '../../../fixtures/lcr-reports');

test.describe.configure({ mode: 'serial' });

let server: CheckoutServer;

// Replacing Current would break the specs that share the suite's server, so this
// spec runs against its own checkout server.
test.beforeAll(async () => {
  server = await startCheckoutServer();
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

test('an Admin imports the three reports from Settings and replaces Current', async ({ page, browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Import in Settings runs on one desktop and one phone engine',
  );
  const phone = testInfo.project.name === 'phone-chromium';
  const checkOverflow = async (): Promise<void> => {
    if (phone) await expectNoHorizontalOverflow(page);
  };

  // A second page on the same server watches Current's tab while the first replaces it.
  let watcher: Page | null = null;
  let before = '';
  if (!phone) {
    watcher = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await watcher.goto(`${server.url}/?layout=desktop`);
    await expect(watcher.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await expect(watcher.locator('.shell-tab-meta', { hasText: 'imported' }).first()).toBeVisible();
    await expect(watcher.locator('.wb-canvas-level')).toHaveText('Ward');
    before = await watcher.locator('body').innerText();
  }

  await page.goto(`${server.url}/settings`);
  await expect(page.getByRole('heading', { name: 'Import', level: 2 })).toBeVisible();
  await checkOverflow();

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
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
    await row.getByRole('button', { name: 'Treat as new person' }).click();
    const adult = row.getByRole('button', { name: 'Adult', exact: true });
    if ((await adult.count()) > 0) await adult.click();
  }
  const replace = page.getByRole('button', { name: 'Replace Current' });
  await expect(replace).toBeEnabled();
  await replace.click();
  await expect(page.getByText(/^Replaced Current\. Matched \d+, created \d+, removed \d+\./)).toBeVisible();
  await checkOverflow();

  if (watcher !== null) {
    // The seeded Current is dated today, so its tab date cannot change; the board content does.
    const watched = watcher;
    await expect.poll(() => watched.locator('body').innerText()).not.toBe(before);
    await watcher.close();
  }
});
