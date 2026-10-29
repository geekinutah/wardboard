import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { uniqueProposalName } from './support/proposals.ts';

/*
 * T-092: the phone layout at `/`. Wide screens keep the desktop shell, and
 * `?layout=` overrides the choice for the browser tab. Only proposals the
 * test creates itself are edited; Current and the seed proposal are read-only here.
 */

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith('phone');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

const SECTIONS = { name: 'Board sections' };

test('phone width opens the phone layout at /', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phone layout applies to the phone projects');
  await page.goto('/');
  const nav = page.getByRole('navigation', SECTIONS);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Dugout · \d+$/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Primary,/ })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Boards' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('the switcher opens a proposal', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phone layout applies to the phone projects');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await page.getByRole('button', { name: /Switch board/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Boards' });
  await sheet.getByRole('button', { name: /Spring adjustments/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByText(/\+\d+ callings? · −\d+ releases? · \d+ vacant/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('layout=desktop keeps the desktop shell after reload', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'the override matters where the phone layout would win');
  const tablist = page.getByRole('tablist', { name: 'Boards' });
  const nav = page.getByRole('navigation', SECTIONS);
  await page.goto('/?layout=desktop');
  await expect(tablist).toBeVisible();
  await page.reload();
  await expect(tablist).toBeVisible();
  await page.goto('/');
  await expect(tablist).toBeVisible();
  await expect(nav).toHaveCount(0);
  await page.goto('/?layout=auto');
  await expect(nav).toBeVisible();
  await expect(tablist).toHaveCount(0);
});

test('wide screens keep the desktop shell', async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), 'wide screens only');
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: 'Boards' })).toBeVisible();
  await expect(page.getByRole('navigation', SECTIONS)).toHaveCount(0);
});

test('an edit on desktop updates the phone without reload', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-chromium', 'one phone engine is enough for the two-client flow');
  const name = uniqueProposalName('Phone sync', testInfo);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  const dugoutTab = page.getByRole('navigation', SECTIONS).getByRole('button', { name: /^Dugout · \d+$/ });
  await expect(dugoutTab).toBeVisible();
  const before = Number(/(\d+)$/.exec((await dugoutTab.textContent()) ?? '')?.[1]);
  expect(Number.isNaN(before)).toBe(false);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const other = await desktop.newPage();
    await other.goto('/?layout=desktop');
    await expect(other.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    const tab = other.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await other.getByRole('button', { name: 'Open Out-of-Unit' }).click();
    const kai = other.locator('.wb-out-of-unit-view article[data-member-id]').filter({ hasText: 'Kai Fictional' });
    await kai.getByRole('button', { name: 'Add to dugout' }).click();
    await expect(kai.getByText('In the dugout · placed here on purpose')).toBeVisible();
  } finally {
    await desktop.close();
  }

  await expect(dugoutTab).toHaveText(new RegExp(`Dugout · ${String(before + 1)}$`));
});
