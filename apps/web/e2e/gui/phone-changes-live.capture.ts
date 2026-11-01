import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './capture-test.ts';
import { guiArtifactsDir } from '../checkout-server.ts';
import { uniqueProposalName } from '../support/proposals.ts';

const SCENARIO = 'phone-changes-live';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

/** The Accept control is a 44px target and sits above the fixed bottom tabs. */
async function expectAboveTabs(page: Page, control: Locator): Promise<void> {
  const controlBox = await control.boundingBox();
  const navBox = await page.getByRole('navigation', { name: 'Board sections' }).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(controlBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  if (controlBox === null || navBox === null) return;
  expect(controlBox.width).toBeGreaterThanOrEqual(44);
  expect(controlBox.height).toBeGreaterThanOrEqual(44);
  expect(controlBox.y).toBeGreaterThanOrEqual(0);
  expect(controlBox.x).toBeGreaterThanOrEqual(0);
  expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(width);
  expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(navBox.y + 1);
}

test('live phone changes draft', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(!project.startsWith('phone'), 'Phone changes apply to the phone projects');
  const shot = async (state: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage: true });
  };

  const name = uniqueProposalName('Phone changes live', testInfo);
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const start = page.getByRole('dialog', { name: 'Start a proposal' });
  await start.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await start.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.getByRole('button', { name: /^Primary,/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primary' })).toBeVisible();
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  await page
    .getByRole('dialog', { name: /^Bea Placeholder/ })
    .getByRole('button', { name: 'Release from Primary Teacher' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Released Bea Placeholder' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Board sections' }).getByRole('button', { name: /^Changes/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Changes', exact: true })).toBeVisible();
  await expect(page.getByText('Bea Placeholder')).toBeVisible();
  await expect(page.getByText(/vs\. its .+ baseline/)).toBeVisible();
  const accept = page.getByRole('button', { name: 'Accept proposal' });
  await expect(accept).toBeVisible();
  await expect(accept).toBeEnabled();
  const releases = page.locator('summary', { hasText: 'Suggested releases' });
  await expect(releases).toBeVisible();
  await expectAboveTabs(page, accept);
  await expectAboveTabs(page, releases);
  await shot('changes-draft');
});
