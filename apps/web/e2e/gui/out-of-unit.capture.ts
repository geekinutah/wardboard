import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'out-of-unit';

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

test('out of unit tile and view preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/out-of-unit');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Verify elements are visible
  await expect(page.getByRole('article', { name: 'Out-of-Unit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Out-of-Unit', level: 3 })).toBeVisible();
  await expect(page.getByText('Outside the ward', { exact: true })).toBeVisible();
  await expect(page.getByText('2 members serving outside the ward')).toBeVisible();
  await expect(page.locator('#out-of-unit-heading')).toBeVisible();
  await expect(
    page.getByText(
      "These members hold callings outside the ward and generally can't be called here. Placing one in a ward calling asks for confirmation.",
    ),
  ).toBeVisible();

  // Overflow and touch targets check before action
  const overflowBefore = await pageOverflow(page);
  expect(overflowBefore.scrollWidth).toBeLessThanOrEqual(overflowBefore.clientWidth);
  await expectButtonsAtLeast44(page);

  // Capture before Add to dugout
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `before-${testInfo.project.name}.png`),
    fullPage: true,
  });

  // Click Add to dugout on Kai
  const kaiArticle = page.locator('article[data-member-id]', { hasText: 'Kai Fictional' });
  await expect(kaiArticle).toBeVisible();
  await kaiArticle.getByRole('button', { name: 'Add to dugout' }).click();

  // Verify updated state
  await expect(kaiArticle.getByText('In the dugout · placed here on purpose')).toBeVisible();

  // Overflow and touch targets check after action
  const overflowAfter = await pageOverflow(page);
  expect(overflowAfter.scrollWidth).toBeLessThanOrEqual(overflowAfter.clientWidth);
  await expectButtonsAtLeast44(page);

  // Capture after Add to dugout
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `after-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
