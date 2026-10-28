import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'phone-changes';

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

test('phone changes preview', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
    });
  };

  await page.goto('/__preview/phone-changes');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // State 1: blocked (initial state with Removed from Current · 2, open Suggested callings, disabled Accept button with reason)
  await expect(page.getByRole('heading', { level: 1, name: 'Changes' })).toBeVisible();
  await expect(page.getByText('Spring adjustments vs. its Jan 4 baseline \u00B7 net only')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Removed from Current · 2' })).toBeVisible();
  await expect(page.getByText('Flo Madeup')).toBeVisible();
  await expect(page.getByText('REMOVED', { exact: true })).toBeVisible();
  await expect(page.getByText('POSITION REMOVED', { exact: true })).toBeVisible();

  const callingsSummary = page.locator('summary', { hasText: 'Suggested callings' });
  const releasesSummary = page.locator('summary', { hasText: 'Suggested releases' });
  const positionsSummary = page.locator('summary', { hasText: 'Position changes' });
  const acceptBtn = page.getByRole('button', { name: 'Accept proposal' });

  await expect(callingsSummary).toBeVisible();
  await expect(releasesSummary).toBeVisible();
  await expect(positionsSummary).toBeVisible();
  await expect(acceptBtn).toBeVisible();
  await expect(acceptBtn).toBeDisabled();
  await expect(page.getByText('Resolve the 2 removed items to accept')).toBeVisible();

  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectAtLeast44(callingsSummary);
    await expectAtLeast44(releasesSummary);
    await expectAtLeast44(positionsSummary);
    await expectAtLeast44(acceptBtn);
  }

  await shot('blocked');

  // State 2: expanded (with Suggested releases and Position changes opened)
  await releasesSummary.click();
  await positionsSummary.click();

  await expect(page.getByText('Ari Sample')).toBeVisible();
  await expect(page.getByText('Sunday School \u00B7 Gospel Doctrine Teacher')).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await shot('expanded');
});
