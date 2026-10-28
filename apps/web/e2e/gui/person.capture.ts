import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'person';
const SHARED =
  'Notes are shared across Current and every proposal. They never appear on the TV or in search.';

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

test('person inspector and notes dialog', async ({ page }, testInfo) => {
  await page.goto('/__preview/person');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Jo Testwell', level: 2 })).toBeVisible();
  await expect(page.getByText('Adult', { exact: true })).toBeVisible();
  await expect(page.getByText('Serves in 2 callings', { exact: true })).toBeVisible();
  await expect(page.getByText('Relief Society Teacher', { exact: true })).toBeVisible();
  await expect(page.getByText('Relief Society Teachers · Relief Society', { exact: true })).toBeVisible();
  await expect(page.getByText('Nursery Leader', { exact: true })).toBeVisible();
  await expect(page.getByText('Nursery · Primary', { exact: true })).toBeVisible();
  await expect(page.getByText('Teaches well', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to dugout' })).toBeVisible();
  await expect(page.getByText(SHARED)).toHaveCount(0);

  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expectButtonsAtLeast44(page);
  await shot('inspector');

  await page.getByRole('button', { name: 'Open notes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Notes · Jo Testwell' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Notes · Jo Testwell' })).toBeVisible();
  await expect(dialog.getByText(SHARED)).toBeVisible();
  const typed = 'Available on Sunday mornings.';
  await dialog.getByRole('textbox', { name: 'Note' }).fill(typed);
  await expect(dialog.getByText(`${String(Array.from(typed).length)} / 280`)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

  const openOverflow = await pageOverflow(page);
  expect(openOverflow.scrollWidth).toBeLessThanOrEqual(openOverflow.clientWidth);
  await expectButtonsAtLeast44(page);
  await shot('notes');
});
