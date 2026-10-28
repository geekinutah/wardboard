import { expect, test, type Page } from '@playwright/test';

/**
 * The accepted-proposal view preview (artboard 26). TV is out of scope.
 */
const isTv = (testInfo: { project: { name: string } }): boolean => testInfo.project.name === 'tv-chromium';

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/__preview/accepted${query}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 })).toBeVisible();
}

test('Copy all puts the summary on the clipboard (desktop-chromium, clipboard permissions granted)', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Real clipboard is checked on desktop Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);

  const groupTexts = await page.locator('.wb-accepted-group pre').allTextContents();
  expect(groupTexts.length).toBeGreaterThan(0);

  const copyAll = page.locator('.wb-accepted-copy-all');
  await copyAll.click();
  await expect(copyAll).toHaveText('Copied');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(groupTexts.join('\n\n'));

  const firstCopy = page.locator('.wb-accepted-copy').first();
  await firstCopy.click();
  await expect(firstCopy).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(groupTexts[0]);
});

test('set Status to Draft then back to Accepted with the keyboard; list updates', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the accepted view');
  await open(page);

  const nav = page.getByRole('navigation', { name: 'Accepted proposals' });
  await expect(nav.getByRole('button', { name: /Spring adjustments/u })).toBeVisible();
  await expect(page.getByText('ACCEPTED', { exact: true })).toBeVisible();

  const status = page.getByLabel('Status');
  await status.focus();
  await status.selectOption('draft');
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(page.getByText('Draft · editable')).toBeVisible();
  await expect(nav.getByRole('button', { name: /Spring adjustments/u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy all' })).toHaveCount(0);

  await status.selectOption('accepted');
  await expect(page.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Spring adjustments/u })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy all' })).toBeVisible();
});

test('blocked variant: reopening to Draft lists why accepting is refused', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the accepted view');
  await open(page, '?blocked=1');
  await page.getByLabel('Status').selectOption('draft');
  await expect(page.getByRole('heading', { name: "Can't accept yet" })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Accepted (read-only)' })).toBeDisabled();
  await expect(page.getByRole('region', { name: "Can't accept yet" }).getByRole('listitem').first()).toContainText(
    /no longer in the ward|needs approval/u,
  );
});

test('phone: no horizontal scroll; controls at least 44px tall', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the accepted view');
  await open(page);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  for (const locator of [
    page.locator('.wb-accepted button'),
    page.locator('.wb-accepted select'),
  ]) {
    const heights = await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  }

  if (testInfo.project.name !== 'desktop-chromium') {
    // The sidebar stacks above the main area on a phone.
    const navBox = await page.getByRole('navigation', { name: 'Accepted proposals' }).boundingBox();
    const mainBox = await page.locator('.wb-accepted-main').boundingBox();
    expect(navBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBeLessThanOrEqual((mainBox?.y ?? 0) + 1);
  }
});
