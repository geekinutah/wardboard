import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

/*
 * The integrated desktop editing layer at `/` on the fixture proposal: the
 * board with the dugout panel, mid-drag, the drop dialog, and the search
 * dropdown. Every drag is cancelled, so nothing is written to the board.
 */

const SCENARIO = 'editing';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses on `source` and moves over `target`, leaving the mouse down. */
async function dragOver(page: Page, source: Locator, target: Locator): Promise<void> {
  const to = await centerOf(target);
  const from = await centerOf(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('[data-dnd-ghost]')).toBeVisible();
  await expect(target).toHaveAttribute('data-drop-active', 'true');
}

test('editing', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'true');
  const dugout = page.getByRole('complementary', { name: /^Dugout/ });
  await expect(dugout).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('board-with-dugout');

  // Mid-drag: Ivy Notreal from the dugout over the Sunday School Secretary vacancy.
  await page.getByRole('article', { name: 'Sunday School' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  const ivy = dugout.locator('article[data-member-id]').filter({ hasText: 'Ivy Notreal' });
  if ((await ivy.count()) === 0) await dugout.getByRole('button', { name: /^Show \d+ more$/ }).click();
  const secretary = page.locator('.wb-org-view [data-position-id]').filter({ hasText: 'Secretary' });
  await dragOver(page, ivy, secretary);
  await expect(page.getByText('Drop here')).toBeVisible();
  await shot('mid-drag', false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-dnd-ghost]')).toHaveCount(0);
  await expect(secretary).toContainText('Vacant');

  // Drop dialog: Gwen Imaginary onto Hana Madeup's calling.
  await page.getByRole('button', { name: 'Fit ward' }).click();
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  const first = page.locator('.wb-org-view [data-position-id]').filter({ hasText: 'First Counselor' });
  const second = page.locator('.wb-org-view [data-position-id]').filter({ hasText: 'Second Counselor' });
  await dragOver(page, first, second);
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Second Counselor is filled' });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('drop-dialog', false);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // Search dropdown open.
  await page.getByRole('button', { name: 'Fit ward' }).click();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.getByRole('searchbox', { name: 'Search people, callings, tags' }).click();
  await page.keyboard.type('Te');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('search-open', false);
});
