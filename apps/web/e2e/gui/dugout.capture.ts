import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'dugout';

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

test('dugout panel preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/dugout');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const panel = page.getByRole('complementary', { name: 'Dugout' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('heading', { name: /Dugout · \d+/ })).toBeVisible();
  await expect(
    page.getByText(
      'People with no calling in this proposal, plus anyone placed here on purpose. Not a measure of availability.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Adults', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Youth', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weekday', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Placed here · still serves as/)).toBeVisible();
  await expect(page.getByText('Needs approval', { exact: true })).toBeVisible();

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
  await shot('default');

  await page.getByRole('button', { name: 'Youth', exact: true }).click();
  await expect(page.locator('article[data-member-id]', { hasText: 'Tai Demo' })).toBeVisible();
  await expect(page.locator('article[data-member-id]', { hasText: 'Cy Mockup' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Youth', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const filteredOverflow = await pageOverflow(page);
  expect(filteredOverflow.scrollWidth).toBeLessThanOrEqual(filteredOverflow.clientWidth);
  await expectButtonsAtLeast44(page);
  await shot('youth');
});
