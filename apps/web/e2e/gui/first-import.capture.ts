import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'first-import';
const REPORTS = path.resolve(import.meta.dirname, '../../../../fixtures/lcr-reports');

let server: CheckoutServer;

// The first import creates Current, so this scenario has its own server with no Current.
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

async function expectNotClipped(locator: Locator): Promise<void> {
  const clipped = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return node.scrollWidth > node.clientWidth + 1 || rect.left < 0 || rect.right > document.documentElement.clientWidth;
  });
  expect(clipped).toBe(false);
}

test('first import on the real server', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'First import runs on one desktop and one phone engine',
  );
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  await page.goto(`${server.url}/`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const heading = page.getByRole('heading', { level: 1, name: 'Set up WardBoard' });
  await expect(heading).toBeVisible();
  await expectNotClipped(heading);
  await expectNotClipped(page.locator('.wb-first-import-text'));

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await expect(page.getByText('out-of-unit-callings.pdf')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(page.locator('.wb-import-section-input'));
  await expectTargetsAtLeast44(page.getByRole('button', { name: 'Preview import' }));
  await shot('setup');

  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(page.locator('.wb-import-section').getByRole('button'));
  // The review lists hundreds of rows; the viewport shows the top of it legibly.
  await shot('review', false);

  const rows = page.locator('.wb-import-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.getByRole('button', { name: 'Treat as new person' }).click();
    const adult = row.getByRole('button', { name: 'Adult', exact: true });
    if ((await adult.count()) > 0) await adult.click();
  }
  await page.getByRole('button', { name: 'Replace Current' }).click();
  await expect(page.getByRole('heading', { name: 'Set up WardBoard' })).toHaveCount(0);
  if (project === 'phone-chromium') {
    await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } else {
    await expect(page.getByRole('tab', { name: /Current/ })).toBeVisible();
  }
  // Let the board paint before the shot.
  await expect(page.getByText('Loading', { exact: false })).toHaveCount(0);
  await shot('board');
});
