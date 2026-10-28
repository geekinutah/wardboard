import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'phone-board';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectAtLeast44(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) {
    return;
  }
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test('phone board preview', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/phone-board');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const list = page.getByRole('main', { name: 'Organizations' });
  await expect(list).toBeVisible();
  const primary = list.getByRole('button', { name: /^Primary,/ });
  await expect(primary).toBeVisible();
  await expect(primary).toContainText(/\d+ vacant/);
  await expect(primary).toContainText(/proposed change|No changes/);
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectAtLeast44(primary);
  }
  await shot('list');

  await primary.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary', exact: true })).toBeVisible();
  await expect(page.getByText(/Overseen by (Bishop|First Counselor|Second Counselor)/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primary Presidency' })).toBeVisible();
  await expect(page.getByText('Yara Fictional')).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  const back = page.locator('.wb-phone-org').getByRole('button', { name: 'Board', exact: true });
  const add = page.getByRole('button', { name: 'Add a position to Primary Teachers', exact: true });
  await expect(back).toBeVisible();
  await expect(add).toBeVisible();
  await expect(page.getByText('+ Proposed')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAtLeast44(add);
  await expectAtLeast44(back);
  await shot('primary');
});
