import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'canvas';

async function shot(section: Locator, projectName: string, state: string): Promise<void> {
  await section.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${state}-${projectName}.png`),
  });
}

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test('canvas zoom levels', async ({ page, baseURL }, testInfo) => {
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await page.goto('/__gallery');
  const section = page.getByRole('region', { name: 'Canvas', exact: true });
  await section.scrollIntoViewIfNeeded();
  const level = section.locator('.wb-canvas-level');
  await expect(level).toHaveText('Ward');

  await section.locator('[data-zoom-target="org:primary"]').click();
  await expect(section.getByText('Selected: Primary', { exact: true })).toBeVisible();
  await shot(section, testInfo.project.name, 'level-1');

  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const buttons = await section.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, width: rect.width, height: rect.height };
    }),
  );
  expect(buttons.map((button) => button.name)).toEqual(['Zoom in', 'Zoom out', 'Fit ward']);
  for (const button of buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }

  if (testInfo.project.name.startsWith('phone')) return;

  const primary = section.locator('[data-zoom-target="org:primary"]');
  const box = await primary.boundingBox();
  if (box === null) throw new Error('Primary tile has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await expect(level).toHaveText('Organization');
  await shot(section, testInfo.project.name, 'level-2');

  await section.locator('[data-zoom-target="group:teachers"]').dblclick();
  await expect(level).toHaveText('Group');
  await section.locator('[data-member-id="ada-fictional"]').dblclick();
  await expect(section.getByText('Notes: Ada Fictional', { exact: true })).toBeVisible();
  await shot(section, testInfo.project.name, 'level-3');

  await section.locator('.wb-canvas').focus();
  await page.keyboard.press('Escape');
  await expect(level).toHaveText('Organization');
  await shot(section, testInfo.project.name, 'after-Esc');
});
