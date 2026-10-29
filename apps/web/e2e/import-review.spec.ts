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

test('a first import names the unresolved row and jumps to it', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Import review runs on one desktop and one phone engine',
  );
  const phone = testInfo.project.name === 'phone-chromium';

  await page.goto(`${server.url}/`);
  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();

  // 1. The callings stat says New callings on an empty ward.
  await expect(page.getByRole('article', { name: /^New callings \d+$/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Unfamiliar callings/ })).toHaveCount(0);

  const rows = page.locator('.wb-import-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(2);
  await expect(rows.first().getByRole('button', { name: 'Treat as new person' })).toHaveCount(0);
  await expect(page.getByText(`${String(count)} of ${String(count)} need a choice`)).toBeVisible();

  // 2. Resolve every row except one in the middle.
  const skipped = Math.floor(count / 2);
  const skippedName = (await rows.nth(skipped).locator('.wb-import-person').textContent()) ?? '';
  expect(skippedName).not.toBe('');
  for (let index = 0; index < count; index += 1) {
    if (index === skipped) continue;
    const label = index % 3 === 0 ? 'Youth' : 'Adult';
    await rows.nth(index).getByRole('button', { name: label, exact: true }).click();
  }

  // 3. Replace is off, the next button names the row, and pressing it focuses and shows that row.
  await expect(page.getByRole('button', { name: 'Resolve 1 identity to continue' })).toBeDisabled();
  await expect(page.getByText('1 of ' + String(count) + ' need a choice')).toBeVisible();
  const next = page.getByRole('button', { name: `Go to next: ${skippedName}` });
  await expect(next).toBeVisible();
  await next.click();
  const target = rows.nth(skipped);
  await expect(target).toBeFocused();
  await expect(target.getByText('Needs a choice')).toBeVisible();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box !== null && viewport !== null) {
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  if (phone) await expectNoHorizontalOverflow(page);

  // 4. Resolve it, then replace.
  await target.getByRole('button', { name: 'Adult', exact: true }).click();
  await expect(page.getByRole('button', { name: /Go to next/ })).toHaveCount(0);
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
