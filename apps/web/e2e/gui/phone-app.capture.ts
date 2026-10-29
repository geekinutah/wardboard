import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'phone-app';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('phone app at the root', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage: true });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  if (!project.startsWith('phone')) {
    // Wide screens keep the desktop shell unchanged.
    await expect(page.getByRole('tablist', { name: 'Boards' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await shot('desktop');
    return;
  }

  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Primary,/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current is read-only' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('board');

  await page.getByRole('button', { name: /Switch board/ }).click();
  await expect(page.getByRole('dialog', { name: 'Boards' })).toBeVisible();
  await shot('switcher');

  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: /Spring adjustments/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  await expect(page.getByText(/\+\d+ callings? · −\d+ releases? · \d+ vacant/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('proposal');

  await page.getByRole('navigation', { name: 'Board sections' }).getByRole('button', { name: 'Search', exact: true }).click();
  const link = page.getByRole('link', { name: 'Use desktop layout' });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
  await shot('placeholder');
});
