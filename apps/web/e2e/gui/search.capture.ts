import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'search';

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

test('search preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/search');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const search = page.getByRole('searchbox', { name: 'Search people, callings, tags' }).first();
  await search.fill('music');
  await expect(page.getByRole('listbox', { name: 'Search results' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Callings' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tags & groups' }).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Search scope' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to dugout' }).first()).toBeVisible();
  await expect(page.getByText("note text isn't searched").first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Read-only', level: 2 })).toBeVisible();

  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await shot('results');
  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expectButtonsAtLeast44(page);

  await page.getByRole('button', { name: 'Tag: Musical' }).first().click();
  const pressed = page.getByRole('button', { name: /Tag: Musical/ }).first();
  await expect(pressed).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed).toContainText('✓');
  await shot('pressed');

  const overflowPressed = await pageOverflow(page);
  expect(overflowPressed.scrollWidth).toBeLessThanOrEqual(overflowPressed.clientWidth);
  await expectButtonsAtLeast44(page);
});
