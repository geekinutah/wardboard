import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'tags';

/**
 * Tags and affinities editors (artboard 10): the default state, the open
 * suggestion list with a Create tag option, and the delete confirmation.
 * TV is out of scope.
 */
test('tags editors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tv-chromium', 'TV is out of scope for the tags editors');

  // The delete dialog is a fixed overlay, so it is captured at the viewport.
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}-${state}.png`),
      fullPage,
    });
  };

  await page.goto('/__preview/tags');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 2, name: 'Tag library' })).toBeVisible();
  await shot('default');

  // Open suggestion list with a Create tag option.
  const combobox = page.getByRole('combobox', { name: 'Add a tag' });
  await combobox.fill('mus');
  await expect(page.getByRole('option', { name: /^Create tag “mus”/u })).toBeVisible();
  await shot('suggestions');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // Edited: a member tag and more preferences, so chips and the match line show.
  await combobox.fill('Teaches');
  await page.getByRole('option', { name: /^Teaches well/u }).click();
  await page.getByRole('button', { name: '+ Preference' }).click();
  await page.getByRole('combobox', { name: 'Add a preference' }).fill('Musical');
  await page.getByRole('option', { name: /^Musical/u }).click();
  await page.getByRole('button', { name: '+ Tag' }).click();
  await page.getByRole('combobox', { name: 'Add a calling tag' }).fill('Spanish');
  await page.getByRole('option', { name: /^Spanish speaker/u }).click();
  await expect(page.getByRole('button', { name: 'Remove tag Teaches well' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove preference Musical' })).toBeVisible();
  await shot('edited');

  // Delete confirmation.
  await page.getByRole('button', { name: /^Delete / }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot('delete', false);
});
