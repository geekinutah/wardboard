import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'proposals';

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  const content = await page.locator('.wb-preview-content').evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }));
  expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
}

async function expectControlsAtLeast44(page: Page): Promise<void> {
  const controls = await page
    .locator('button, input:not([type="radio"]), textarea, label:has(input[type="radio"])')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.textContent;
        return { name: text.trim().slice(0, 80), height: rect.height, width: rect.width };
      }),
    );
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.height, control.name).toBeGreaterThanOrEqual(44);
    expect(control.width, control.name).toBeGreaterThanOrEqual(44);
  }
}

test('proposals preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/proposals');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByText('Read-only · imported Oct 24, 2026')).toBeVisible();
  await expect(page.getByText("Current can't be edited. Start a proposal to plan changes.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start proposal' })).toBeVisible();

  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await expectNoHorizontalScroll(page);
  await expectControlsAtLeast44(page);
  await shot('bar');

  await page.getByRole('button', { name: 'Start proposal' }).click();
  await page.getByRole('radio', { name: 'Duplicate “Spring adjustments”' }).check();
  await page.getByRole('textbox', { name: 'Name' }).fill('Primary staffing');
  await expect(page.getByRole('dialog', { name: 'Start a proposal' })).toBeVisible();
  await expect(page.getByText('Start from')).toBeVisible();
  await expect(page.getByText("Baseline is today's Current (Oct 24, 2026 import)")).toBeVisible();
  await expect(page.getByText('Copies its arrangement; keeps its original baseline').first()).toBeVisible();
  await expect(page.getByText('Copies its arrangement; keeps its original baseline · Accepted')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Duplicate “Spring adjustments”' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Rationale (optional)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create proposal' })).toBeEnabled();

  const selected = page.getByRole('radio', { name: 'Duplicate “Spring adjustments”' });
  const box = await selected.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    expect(box.width).toBeGreaterThanOrEqual(12);
    expect(box.height).toBeGreaterThanOrEqual(12);
  }

  await expectNoHorizontalScroll(page);
  await expectControlsAtLeast44(page);
  await shot('dialog');
});
