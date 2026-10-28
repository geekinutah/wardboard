import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'aaronic';

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

test('aaronic preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/aaronic');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Priests Quorum' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Teachers Quorum' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deacons Quorum' })).toBeVisible();
  await expect(page.getByText('Overseen by Bishop · fixed by office')).toBeVisible();
  await expect(page.getByText('Presides by office · linked from Bishopric')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Priests Quorum' }).getByRole('button', { name: 'Change' })).toHaveCount(0);
  await expect(page.getByText('Vacant').first()).toBeVisible();

  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await shot('default');
  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.getByRole('region', { name: 'Teachers Quorum' }).getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('radio', { name: 'First Counselor' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Bishop' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Second Counselor' })).toBeVisible();
  await shot('change-open');

  const overflowOpen = await pageOverflow(page);
  expect(overflowOpen.scrollWidth).toBeLessThanOrEqual(overflowOpen.clientWidth);
  await expectButtonsAtLeast44(page);
});
