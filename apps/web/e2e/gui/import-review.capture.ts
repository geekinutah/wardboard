import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'import-review';
const REPORTS = path.resolve(import.meta.dirname, '../../../../fixtures/lcr-reports');

let server: CheckoutServer;

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

test('import review rows and next unresolved', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Import review runs on one desktop and one phone engine',
  );
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = false): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  await page.goto(`${server.url}/`);
  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expectNoHorizontalOverflow(page);

  const rows = page.locator('.wb-import-row');
  const count = await rows.count();
  const firstRow = rows.first();
  await firstRow.scrollIntoViewIfNeeded();
  await expect(firstRow.getByText('Needs a choice')).toBeVisible();
  // Adult and Youth only, at least 44px.
  const heights = await firstRow.getByRole('button').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  expect(heights).toHaveLength(2);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  await shot('first-import-rows');

  const skipped = Math.floor(count / 2);
  for (let index = 0; index < count; index += 1) {
    if (index === skipped) continue;
    await rows.nth(index).getByRole('button', { name: 'Adult', exact: true }).click();
  }
  const name = (await rows.nth(skipped).locator('.wb-import-person').textContent()) ?? '';
  const next = page.getByRole('button', { name: `Go to next: ${name}` });
  await next.scrollIntoViewIfNeeded();
  const nextHeight = (await next.boundingBox())?.height ?? 0;
  expect(nextHeight).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(rows.nth(skipped)).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await shot('next-unresolved');
});
