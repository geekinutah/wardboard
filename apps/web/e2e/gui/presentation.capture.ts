import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'presentation';

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test('presentation preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/presentation');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Show Needs approval off', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Show Needs approval on', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 }).first()).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  await expect(page.getByText('Ring = proposed change').first()).toBeVisible();

  const presentations = page.locator('.wb-presentation');
  await expect(presentations).toHaveCount(2);
  await expect(presentations.nth(0)).not.toContainText('Needs approval');
  await expect(presentations.nth(1).getByText('Needs approval').first()).toBeVisible();

  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const project = testInfo.project.name;
  if (project.startsWith('phone')) {
    const buttons = await page.getByRole('button', { name: 'Exit presentation' }).evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      }),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.width).toBeGreaterThanOrEqual(44);
    }
  }

  if (project === 'tv-chromium') {
    const count = await presentations.count();
    for (let index = 0; index < count; index += 1) {
      const fit = await presentations.nth(index).evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    }
  }

  await presentations.nth(0).screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${project}.png`),
  });
  await presentations.nth(1).screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${project}-needs-approval.png`),
  });
});
