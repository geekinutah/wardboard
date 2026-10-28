import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { createProposal, uniqueProposalName } from '../support/proposals.ts';

/*
 * The Out-of-Unit tile, the opened view and the second-calling dialog on the
 * integrated board at `/`. It works on a Draft it creates, so the shared seed
 * proposal and Current are never edited. The dialog is cancelled. Phones have
 * no desktop drag and drop (SPEC §10, B-032): they capture the tile and view.
 */

const SCENARIO = 'out-of-unit-board';

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

test('out-of-unit-board', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const phone = project.startsWith('phone');
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  const name = uniqueProposalName('Outside capture', testInfo);
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  await page.getByRole('tab', { name }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', phone ? 'false' : 'true');

  const tile = page.getByRole('article', { name: 'Out-of-Unit' });
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('overview-with-tile');

  await page.getByRole('button', { name: 'Open Out-of-Unit' }).click();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  const kaiCard = page.locator('.wb-out-of-unit-view article[data-member-id]').filter({ hasText: 'Kai Fictional' });
  await expect(kaiCard).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('opened-view');

  await kaiCard.getByRole('button', { name: 'Add to dugout' }).click();
  await expect(kaiCard.getByText('In the dugout · placed here on purpose')).toBeVisible();
  if (phone) return;

  // Carry Kai from the dugout to a vacancy in Relief Society Teachers.
  const dugout = page.getByRole('complementary', { name: /^Dugout/ });
  const row = dugout.locator('article[data-member-id]').filter({ hasText: 'Kai Fictional' });
  if ((await row.count()) === 0) await dugout.getByRole('button', { name: /^Show \d+ more$/ }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]').dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  const vacancy = page.locator('[data-position-id]').filter({ hasText: 'Vacant' }).first();
  await expect(vacancy).toBeVisible();

  const from = await centerOf(row);
  const to = await centerOf(vacancy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('[data-dnd-ghost]')).toBeVisible();
  await expect(async () => {
    const box = await vacancy.boundingBox();
    if (box === null) throw new Error('target has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await expect(vacancy).toHaveAttribute('data-drop-active', 'true', { timeout: 500 });
  }).toPass();
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Give Kai Fictional a second calling?' });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('second-calling-dialog', false);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
