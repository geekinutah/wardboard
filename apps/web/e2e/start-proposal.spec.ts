import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

/*
 * Start proposal on the real checkout server (fictional fixture ward).
 * Runs in every Playwright project. Mouse clicks and keyboard typing only.
 */

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectAtLeast44(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('missing box');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test('start a proposal from Current and land on its tab', async ({ page }, testInfo: TestInfo) => {
  const proposalName = `New plan ${testInfo.project.name}`;
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');

  const bar = page.getByRole('region', { name: 'Current is read-only' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Read-only · imported [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(bar).toContainText("Current can't be edited. Start a proposal to plan changes.");
  const barButton = bar.getByRole('button', { name: 'Start proposal', exact: true });
  const tabButton = page.getByRole('button', { name: '+ Start proposal', exact: true });
  await expect(barButton).toBeVisible();
  await expect(tabButton).toBeVisible();
  await expectAtLeast44(barButton);
  await expectAtLeast44(tabButton);
  await expectNoHorizontalOverflow(page);

  await barButton.click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Current' })).toBeChecked();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');

  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(proposalName);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();

  await expect(dialog).toHaveCount(0);
  const created = page.getByRole('tab', { name: proposalName, exact: true });
  await expect(created).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Start proposal', exact: true })).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expectNoHorizontalOverflow(page);

  await page.reload();
  // A loaded parallel suite can miss the first socket; reconnect backoff is 1s, then 2s.
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab', { name: proposalName, exact: true })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);
});
