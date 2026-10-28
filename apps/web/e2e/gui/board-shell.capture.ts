import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'board-shell';

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

test('board shell', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) await expectButtonsAtLeast44(page);
  await shot('current-level-1');

  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with its baseline')).toBeVisible();
  await expect(page.getByText(/\+ \d+ suggested callings/)).toBeVisible();
  await expect(page.getByText(/\u2212 \d+ suggested releases/)).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expectNoHorizontalOverflow(page);
  await shot('proposal-level-1');

  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]').dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await page.getByRole('button', { name: 'Add position to Relief Society Teachers' }).click();
  await expect(page.getByRole('textbox', { name: 'Calling title' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Single person' })).toBeChecked();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) await expectButtonsAtLeast44(page);
  await shot('proposal-level-3-add');
});
