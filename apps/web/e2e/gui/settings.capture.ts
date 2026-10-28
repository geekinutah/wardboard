import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'settings';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectButtonsAtLeast44(page: Page): Promise<void> {
  const buttons = await page.getByRole('button').evaluateAll((nodes) =>
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

test('settings preview screens', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  // 1. Admin page
  await page.goto('/__preview/settings');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People & access', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Presentation', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backup & restore', level: 2 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectButtonsAtLeast44(page);

  await shot('admin-page');
  await shot('admin');

  // 2. Remove access dialog
  const benRow = page.locator('.wb-settings-row', { hasText: 'Ben Editor' });
  await benRow.getByRole('button', { name: 'Remove access' }).click();
  const removeDialog = page.getByRole('dialog');
  await expect(removeDialog).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Remove access for Ben Editor?' }),
  ).toBeVisible();
  await expectButtonsAtLeast44(page);

  await shot('remove-access-dialog');

  // Cancel dialog
  await removeDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(removeDialog).not.toBeVisible();

  // 3. Restore confirmation dialog
  const fileInput = page.getByLabel('Backup file');
  await fileInput.setInputFiles({
    name: 'ward.backup',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('fictional backup data'),
  });

  const restoreDialog = page.getByRole('dialog');
  await expect(restoreDialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restore ward.backup?' })).toBeVisible();
  await expect(restoreDialog.getByText('41 members')).toBeVisible();
  await expectButtonsAtLeast44(page);

  await shot('restore-confirmation-dialog');
  await shot('restore-dialog');

  // Cancel restore dialog
  await restoreDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(restoreDialog).not.toBeVisible();

  // 4. Editor page (after View as Editor)
  await page.getByLabel('View as Editor').check();
  await expect(page.getByText('Only an Admin can manage access.')).toBeVisible();
  await expect(page.getByText('Only an Admin can create or restore backups.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectButtonsAtLeast44(page);

  await shot('editor-page');
  await shot('editor');
});
