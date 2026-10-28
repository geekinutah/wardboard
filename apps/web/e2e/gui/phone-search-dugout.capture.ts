import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
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

test('phone search capture', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, 'phone-search', `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/phone-search');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Callings' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Tags' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('initial');

  // Add Ada Fictional to dugout
  const addAda = page.getByRole('button', { name: 'Add Ada Fictional to dugout' });
  await addAda.click();
  await expect(page.getByText('In dugout').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('in-dugout');
});

test('phone dugout capture', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, 'phone-dugout', `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/phone-dugout');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { level: 1, name: /Dugout/ })).toBeVisible();
  await expect(page.getByText(/Placed here · still/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('all');

  // Filter by Youth
  const youthChip = page.getByRole('button', { name: /Youth/ });
  await youthChip.click();
  await expect(page.getByText('Tai Demo')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('youth');
});
