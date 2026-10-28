import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'phone-person';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectDialogButtonsAtLeast44(dialog: Locator): Promise<void> {
  const buttons = await dialog.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height, width: rect.width };
    }),
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.height, button.name).toBeGreaterThanOrEqual(44);
    expect(button.width, button.name).toBeGreaterThanOrEqual(44);
  }
}

test('phone person and move sheets capture', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/phone-person');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // 1. Initial State: Person Sheet open for Jo Testwell over Primary
  const personDialog = page.getByRole('dialog', { name: /Jo Testwell/ });
  await expect(personDialog).toBeVisible();
  await expect(personDialog.getByRole('heading', { name: /Jo Testwell/, level: 2 })).toBeVisible();
  await expect(personDialog.getByText('· Adult')).toBeVisible();
  await expect(personDialog.getByText('Teaches well')).toBeVisible();
  await expect(personDialog.getByText('Relief Society Teacher', { exact: true })).toBeVisible();
  await expect(personDialog.getByText('Nursery Leader', { exact: true })).toBeVisible();
  await expect(personDialog.getByRole('button', { name: 'Move from Relief Society Teacher' })).toBeVisible();
  await expect(personDialog.getByRole('button', { name: 'Release from Relief Society Teacher' })).toBeVisible();
  await expect(personDialog.getByRole('button', { name: 'Move from Nursery Leader' })).toBeVisible();
  await expect(personDialog.getByRole('button', { name: 'Release from Nursery Leader' })).toBeVisible();
  await expect(personDialog.getByRole('button', { name: /Add to dugout/ })).toBeVisible();
  await expect(personDialog.getByText('keeps current callings')).toBeVisible();
  await expect(personDialog.getByRole('button', { name: 'Profile, note & photo' })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectDialogButtonsAtLeast44(personDialog);
  await shot('person-sheet');

  // 2. Open Move Sheet for Nursery Leader
  const moveBtn = personDialog.getByRole('button', { name: 'Move from Nursery Leader' });
  await moveBtn.click();

  const moveDialog = page.getByRole('dialog', { name: 'Move Jo Testwell' });
  await expect(moveDialog).toBeVisible();
  await expect(moveDialog.getByRole('heading', { name: 'Move Jo Testwell', level: 2 })).toBeVisible();
  await expect(
    moveDialog.getByText('Releases from Primary · Nursery · Nursery Leader. Tap a destination.'),
  ).toBeVisible();
  await expect(moveDialog.getByRole('searchbox', { name: 'Find a calling' })).toBeVisible();
  await expect(moveDialog.getByText('Vacant positions')).toBeVisible();
  await expect(moveDialog.getByText('Matches Teaches well').first()).toBeVisible();
  await expect(moveDialog.getByRole('button', { name: 'Send to dugout' })).toBeVisible();
  await expect(moveDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectDialogButtonsAtLeast44(moveDialog);
  await shot('move-sheet');
});
