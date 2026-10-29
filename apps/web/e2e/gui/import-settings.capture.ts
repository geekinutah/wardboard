import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'import-settings';
const REPORTS = path.resolve(import.meta.dirname, '../../../../fixtures/lcr-reports');

let server: CheckoutServer;

// Replacing Current would break the other scenarios on the shared server, so this one has its own.
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
  const targets = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height };
    }),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) expect(target.height, target.name).toBeGreaterThanOrEqual(44);
}

async function expectInsideSettingsColumn(page: Page): Promise<void> {
  const fits = await page.evaluate(() => {
    const section = document.querySelector('.wb-import-section');
    const review = document.querySelector('.wb-import-section .wb-import');
    if (section === null || review === null) return false;
    const outer = section.getBoundingClientRect();
    const inner = review.getBoundingClientRect();
    return inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && review.scrollWidth <= review.clientWidth;
  });
  expect(fits).toBe(true);
}

test('import in settings on the real server', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Import in Settings runs on one desktop and one phone engine',
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

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await expect(section.getByText('out-of-unit-callings.pdf')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.locator('.wb-import-section-input'));
  await expectTargetsAtLeast44(section.getByRole('button', { name: 'Preview import' }));
  await shot('sources');

  await section.getByRole('button', { name: 'Preview import' }).click();
  await expect(section.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInsideSettingsColumn(page);
  await expectTargetsAtLeast44(section.getByRole('button'));
  await shot('review');

  const rows = section.locator('.wb-import-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.getByRole('button', { name: 'Treat as new person' }).click();
    const adult = row.getByRole('button', { name: 'Adult', exact: true });
    if ((await adult.count()) > 0) await adult.click();
  }
  await section.getByRole('button', { name: 'Replace Current' }).click();
  const done = section.getByText(/^Replaced Current\. Matched \d+, created \d+, removed \d+\./);
  await expect(done).toBeVisible();
  await done.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await shot('replaced');
});
