import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

/*
 * Integrated app at `/`: Current with the read-only bar, the start-proposal
 * dialog, and the new tab selected. Compared with artboard 15.
 */

const SCENARIO = 'start-proposal';

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
  if (box === null) throw new Error('missing box');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test('start proposal', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const proposalName = `Primary ${project}`;
  const shot = async (state: string, fullPage: boolean): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage,
    });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');

  const bar = page.getByRole('region', { name: 'Current is read-only' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Read-only · imported/);
  await expect(bar).toContainText("Current can't be edited. Start a proposal to plan changes.");
  const barButton = bar.getByRole('button', { name: 'Start proposal', exact: true });
  const tabButton = page.getByRole('button', { name: '+ Start proposal', exact: true });
  await expectAtLeast44(barButton);
  await expectAtLeast44(tabButton);
  await expectNoHorizontalOverflow(page);
  await shot('current-bar', true);

  await barButton.click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Current' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Duplicate “Spring adjustments”' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type('Primary staffing');
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Primary staffing');
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await shot('dialog-open', false);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(proposalName);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();
  await expect(dialog).toHaveCount(0);
  const created = page.getByRole('tab', { name: proposalName, exact: true });
  await expect(created).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current is read-only' })).toHaveCount(0);
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await shot('new-tab', false);
});
