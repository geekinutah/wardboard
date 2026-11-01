import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from './capture-test.ts';
import { guiArtifactsDir } from '../checkout-server.ts';
import { uniqueProposalName } from '../support/proposals.ts';

const SCENARIO = 'phone-search-live';

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
      return { name: node.getAttribute('aria-label') ?? node.textContent, height: rect.height, width: rect.width };
    }),
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.height, button.name).toBeGreaterThanOrEqual(44);
    expect(button.width, button.name).toBeGreaterThanOrEqual(44);
  }
}

test('live phone search and dugout', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(!project.startsWith('phone'), 'Phone search and dugout apply to the phone projects');
  const shot = async (state: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await expectButtonsAtLeast44(page);
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage: true });
  };

  const name = uniqueProposalName('Phone search live', testInfo);
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const start = page.getByRole('dialog', { name: 'Start a proposal' });
  await start.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await start.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Primary,/ })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Board sections' });
  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search' });
  await search.click();
  await page.keyboard.type('mu');
  await expect(page.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tag: Musical|Musical/ }).first()).toBeVisible();
  await shot('search-results');

  await page.getByRole('button', { name: /^Flo Madeup/ }).click();
  const sheet = page.getByRole('dialog', { name: /^Flo Madeup/ });
  await expect(sheet).toBeVisible();
  await expect(search).toBeVisible();
  await shot('search-person');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await nav.getByRole('button', { name: /^Dugout · / }).click();
  await expect(
    page.getByText('No calling in this proposal, or placed here on purpose. Not a measure of availability.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place Jay Storybook' })).toBeVisible();
  await shot('dugout-list');
});
