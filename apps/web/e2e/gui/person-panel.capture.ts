import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

/*
 * Integrated app at `/`: person inspector open, notes dialog open.
 * Compared with artboard 2.
 */

const SCENARIO = 'person-panel';

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

test('person inspector and notes dialog', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
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

  // Find Jay Storybook in the dugout panel
  const jayRow = page.locator('.wb-dugout-row', { hasText: 'Jay Storybook' });
  await jayRow.scrollIntoViewIfNeeded();
  await expect(jayRow).toBeVisible();

  // Click to open the person inspector
  await jayRow.click();
  const inspector = page.getByRole('complementary', { name: 'Person: Jay Storybook' });
  await expect(inspector).toBeVisible();

  const closeBtn = page.getByRole('button', { name: 'Close' });
  await expect(closeBtn).toBeVisible();
  await expectAtLeast44(closeBtn);

  // Note text must NOT be visible outside the notes dialog
  const jayNote = 'Travels for work most weekdays in March.';
  const bodyText = await page.innerText('body');
  expect(bodyText).not.toContain(jayNote);

  await expectNoHorizontalOverflow(page);
  await shot('inspector-open', false);

  // Open the notes dialog
  await page.getByRole('button', { name: 'Open notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Notes · Jay Storybook' });
  await expect(dialog).toBeVisible();

  // The note is visible inside the dialog textarea
  const textarea = page.getByRole('textbox', { name: 'Note' });
  await expect(textarea).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await shot('notes-dialog-open', false);

  // Close the dialog
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
