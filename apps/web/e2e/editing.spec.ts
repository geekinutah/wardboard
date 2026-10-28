import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createProposal } from './support/proposals.ts';

/*
 * Desktop editing on the real checkout server (fictional fixture ward).
 * Desktop and TV drag with the real mouse. Each drag test works on its own
 * proposal, started from Current over the operation channel, so projects
 * running in parallel never edit the same board. The phone projects only
 * check that the page renders without horizontal scrolling: the desktop
 * shell is not the phone layout, and its drag and drop stays off there
 * (SPEC §10, B-032) so a swipe on a card scrolls the page.
 */

const SEARCH = 'Search people, callings, tags';

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

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
}

/** Phone projects: the page renders, with the dugout panel, and never scrolls sideways. */
async function phoneRendersOnly(page: Page, testInfo: TestInfo): Promise<boolean> {
  if (!isPhone(testInfo)) return false;
  await openApp(page);
  await expect(page.getByRole('complementary', { name: /^Dugout/ })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: SEARCH })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  return true;
}

async function openProposalTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  // Drags start once the baseline is loaded (approvals are checked against it).
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'true');
}

async function openOrg(page: Page, name: string): Promise<void> {
  await page.getByRole('article', { name }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
}

async function dugoutRow(page: Page, name: string): Promise<Locator> {
  const panel = page.getByRole('complementary', { name: /^Dugout/ });
  const row = panel.locator('article[data-member-id]').filter({ hasText: name });
  if ((await row.count()) === 0) {
    await panel.getByRole('button', { name: /^Show \d+ more$/ }).click();
  }
  await expect(row).toHaveCount(1);
  return row;
}

function orgCard(page: Page, title: string): Locator {
  return page.locator('.wb-org-view [data-position-id]').filter({ hasText: title });
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Keeps the pointer on `target` until it is the active drop target. A proposal
 * created by a test running in parallel adds a header tab, which can wrap the
 * header and shift the board mid-drag; a person would follow the card too.
 */
async function followTarget(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    const box = await target.boundingBox();
    if (box === null) throw new Error('target has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await expect(target).toHaveAttribute('data-drop-active', 'true', { timeout: 500 });
  }).toPass();
}

/** A real mouse drag: press, move past the threshold in steps, release over the target. */
async function mouseDrag(page: Page, source: Locator, target: Locator): Promise<void> {
  const to = await centerOf(target);
  const from = await centerOf(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('[data-dnd-ghost]')).toBeVisible();
  await followTarget(page, target);
  await page.mouse.up();
}

test('drag a dugout member into a vacancy and see it after reload', async ({ page }, testInfo) => {
  if (await phoneRendersOnly(page, testInfo)) return;
  const name = `Editing vacancy ${testInfo.project.name}`;
  await openApp(page);
  await createProposal(page, name);
  await openProposalTab(page, name);
  await openOrg(page, 'Sunday School');

  const secretary = orgCard(page, 'Secretary');
  await expect(secretary).toContainText('Vacant');
  await mouseDrag(page, await dugoutRow(page, 'Ivy Notreal'), secretary);

  await expect(secretary).toContainText('Ivy Notreal');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/Couldn't apply the change/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await openProposalTab(page, name);
  await openOrg(page, 'Sunday School');
  await expect(orgCard(page, 'Secretary')).toContainText('Ivy Notreal');
  await expect(
    page.getByRole('complementary', { name: /^Dugout/ }).locator('article[data-member-id]').filter({ hasText: 'Ivy Notreal' }),
  ).toHaveCount(0);
});

test('drop on an occupied calling and Swap', async ({ page }, testInfo) => {
  if (await phoneRendersOnly(page, testInfo)) return;
  const name = `Editing swap ${testInfo.project.name}`;
  await openApp(page);
  await createProposal(page, name);
  await openProposalTab(page, name);
  await openOrg(page, 'Relief Society');

  const first = orgCard(page, 'First Counselor');
  const second = orgCard(page, 'Second Counselor');
  await expect(first).toContainText('Gwen Imaginary');
  await expect(second).toContainText('Hana Madeup');
  await mouseDrag(page, first, second);

  const dialog = page.getByRole('dialog', { name: 'Second Counselor is filled' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Swap/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Swap' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(first).toContainText('Hana Madeup');
  await expect(second).toContainText('Gwen Imaginary');
  await expect(page.getByText(/Couldn't apply the change/)).toHaveCount(0);
});

test('search for a person and jump to their calling', async ({ page }, testInfo) => {
  if (await phoneRendersOnly(page, testInfo)) return;
  await openApp(page);

  const search = page.getByRole('searchbox', { name: SEARCH });
  await search.click();
  await page.keyboard.type('Hal Testwell');
  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByRole('option', { name: /Hal Testwell/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Temple and Family History');
  await expect(page.locator('.wb-group-detail [data-member-id]').filter({ hasText: 'Hal Testwell' })).toBeVisible();
  // Leaving the field closes the results so the board is visible again.
  await expect(results).toBeHidden();
});

/** The computed `touch-action` of an element (a card must not block page panning on phones). */
async function touchAction(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).touchAction);
}

/** A one-finger swipe with Chromium's touch input, from `start` downwards by `distance` pixels. */
async function touchSwipeDown(page: Page, start: { x: number; y: number }, distance: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
  for (let step = 1; step <= 15; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y + (distance * step) / 15 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('drag and drop is on for desktop and TV, and off on phones where a swipe on a card scrolls (B-032)', async ({
  page,
  browserName,
}, testInfo) => {
  const name = `Editing touch ${testInfo.project.name}`;
  await openApp(page);
  await createProposal(page, name);
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  // The suggested-callings count appears once the baseline has loaded.
  await expect(page.locator('.shell-count-callings')).toBeVisible();
  await openOrg(page, 'Relief Society');
  const card = orgCard(page, 'First Counselor');
  await expect(card).toContainText('Gwen Imaginary');
  await expect(card).toHaveAttribute('data-member-id', /.+/u);
  const row = await dugoutRow(page, 'Ivy Notreal');

  if (!isPhone(testInfo)) {
    await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'true');
    expect(await touchAction(card)).toBe('none');
    expect(await touchAction(row)).toBe('none');
    return;
  }

  // Phones get their own interaction model (SPEC §10): the desktop drag surface stays off.
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'false');
  expect(await touchAction(card)).toBe('auto');
  expect(await touchAction(row)).toBe('auto');
  await expectNoHorizontalOverflow(page);
  if (browserName !== 'chromium') return;

  // A real touch swipe that starts on a dugout row scrolls the page and starts no drag.
  await row.evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);
  const box = await row.boundingBox();
  if (box === null) throw new Error('dugout row has no box');
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchSwipeDown(page, start, Math.min(200, viewport.height - 10 - start.y));
  await expect(page.locator('[data-dnd-ghost]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 50);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
