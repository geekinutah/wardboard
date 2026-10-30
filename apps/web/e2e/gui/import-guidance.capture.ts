import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'import-guidance';
const REPORTS = path.resolve(import.meta.dirname, '../../../../fixtures/lcr-reports');

let server: CheckoutServer;

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

async function expectTargetsAtLeast44(locator: Locator): Promise<void> {
  const heights = await locator.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
}

test('import sources guidance in settings', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Import guidance runs on one desktop and one phone engine',
  );
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage: true });
  };

  await page.goto(`${server.url}/settings`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const section = page.locator('.wb-import-section');
  await expect(section.getByRole('heading', { name: 'Import', level: 2 })).toBeVisible();
  await section.scrollIntoViewIfNeeded();

  const hints = section.locator('.wb-import-section-hint');
  await expect(hints).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(hints.nth(index)).toBeVisible();
  const summary = section.getByText('How to get these reports');
  await expect(summary).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.locator('.wb-import-section-input'));
  await expectTargetsAtLeast44(section.locator('summary'));
  await shot('sources-closed');

  await summary.click();
  await expect(section.getByText('docs/import/guide.md')).toBeVisible();
  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await page.getByLabel('Member list').setInputFiles(path.join(REPORTS, 'member-list.pdf'));
  await expect(section.getByText('out-of-unit-callings.pdf')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.locator('.wb-import-section-input'));
  await expectTargetsAtLeast44(section.locator('summary'));
  await shot('sources-open');
});
