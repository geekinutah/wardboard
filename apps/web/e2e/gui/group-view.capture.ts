import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'group-view';

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
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

test('group detail preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/group-view');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Relief Society · Relief Society Teachers' }).first()).toBeVisible();
  await expect(page.getByText(/List · \d+ of \d+ filled/u).first()).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Read-only', level: 2 })).toBeVisible();

  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  if (project === 'phone-chromium' || !project.startsWith('phone')) {
    await shot('default');
  }

  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
    return;
  }

  await page.getByRole('button', { name: 'Add position to Primary Presidency' }).click();
  await page.getByRole('radio', { name: 'List' }).check();
  await page.getByRole('textbox', { name: 'Calling title' }).fill('Teacher (age 10)');
  await expect(page.getByRole('spinbutton', { name: 'Positions' })).toHaveValue('2');
  await expect(page.getByText('Calling title')).toBeVisible();
  await expect(page.getByText('Type', { exact: true })).toBeVisible();
  await expect(page.getByText('Positions', { exact: true })).toBeVisible();
  await shot('add-position-form-open');

  const overflowOpen = await pageOverflow(page);
  expect(overflowOpen.scrollWidth).toBeLessThanOrEqual(overflowOpen.clientWidth);
  await expectButtonsAtLeast44(page);
});
