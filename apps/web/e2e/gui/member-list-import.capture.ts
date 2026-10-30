import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'member-list-import';
const REPORTS = path.resolve(import.meta.dirname, '../../../../fixtures/lcr-reports');

let server: CheckoutServer;

// The import creates Current, so this scenario has its own server with no Current.
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

test('member list picker and review source', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Member list import runs on one desktop and one phone engine',
  );
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  await page.goto(`${server.url}/`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Set up WardBoard' })).toBeVisible();
  const section = page.locator('.wb-import-section');
  await expect(section.locator('.wb-import-section-file')).toHaveCount(4);

  await page.getByLabel('Organizations and callings').setInputFiles(path.join(REPORTS, 'organizations-and-callings.pdf'));
  await page.getByLabel('Members without callings').setInputFiles(path.join(REPORTS, 'members-without-callings.pdf'));
  await page.getByLabel('Out-of-unit callings').setInputFiles(path.join(REPORTS, 'out-of-unit-callings.pdf'));
  await page.getByLabel('Member list').setInputFiles(path.join(REPORTS, 'member-list.pdf'));
  await expect(section.getByText('member-list.pdf')).toBeVisible();

  const memberList = section.locator('.wb-import-section-file').nth(3);
  await expect(memberList.locator('.wb-import-section-label')).toHaveText('Member list');
  await expectNotClipped(memberList.locator('.wb-import-section-label'));
  await expectNotClipped(memberList.locator('.wb-import-section-hint'));
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.locator('.wb-import-section-input'));
  await expectTargetsAtLeast44(page.getByRole('button', { name: 'Preview import' }));
  await memberList.scrollIntoViewIfNeeded();
  await shot('sources');

  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  const card = page.getByRole('article', { name: 'Member list, Validated' });
  await expect(card).toBeVisible();
  await expectNotClipped(card);
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(page.locator('.wb-import-row').getByRole('button'));
  await shot('review');
});
