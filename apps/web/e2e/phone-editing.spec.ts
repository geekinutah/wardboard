import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { uniqueProposalName } from './support/proposals.ts';

/*
 * T-094: person, move and fill sheets on the phone Board tab.
 *
 * Fixture ward (core fixtures; a new proposal copies Current):
 * - Bea Placeholder: Primary · Primary Teachers · Primary Teacher (list; two
 *   of its four seats are vacant on Current).
 * - Primary Presidency · Secretary: vacant (single).
 * - Ward-wide Callings · Music · Chorister: vacant (single), prefers Musical.
 * - Ivy Notreal: in the dugout with no calling, tagged Musical.
 * Each test edits only the proposal it creates; Current is never edited.
 */

const SKIP_REASON = 'Phone sheets apply to the phone projects';

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

/** The dialog's box sits inside the viewport width. */
async function expectWithinWidth(page: Page, dialog: Locator): Promise<void> {
  const box = await dialog.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(width);
}

async function openCurrent(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
}

/** Starts a Draft from Current through the phone switcher; it opens on the phone. */
async function startProposal(page: Page, name: string): Promise<void> {
  await openCurrent(page);
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a proposal' });
  await dialog.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await dialog.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Opens an organization; on a Draft, waits until the board is editable. */
async function openOrg(page: Page, name: string, editable: boolean): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name},`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const hint = editable ? 'Tap a person for options · tap a vacancy to fill it' : 'This board is read-only';
  await expect(page.getByText(hint)).toBeVisible();
}

function vacantRows(page: Page, title: string): Locator {
  return page.getByRole('button', { name: `Vacant, ${title}`, exact: true });
}

function personSheet(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name: new RegExp(`^${name}`) });
}

test('Current shows the person sheet without Move', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await openCurrent(page);
  await openOrg(page, 'Primary', false);
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const sheet = personSheet(page, 'Bea Placeholder');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Callings in Current');
  await expect(sheet.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Release/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('move a person to a vacant calling', async ({ page, browser }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  const name = uniqueProposalName('Phone move', testInfo);
  await startProposal(page, name);

  // phone-chromium only: a desktop client on the same proposal watches the move.
  const watch = testInfo.project.name === 'phone-chromium';
  const desktop = watch ? await browser.newContext({ viewport: { width: 1440, height: 900 } }) : null;
  try {
    const other = desktop === null ? null : await desktop.newPage();
    if (other !== null) {
      await other.goto('/?layout=desktop');
      await expect(other.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
      const tab = other.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await other.getByRole('article', { name: 'Primary' }).dblclick();
      await expect(other.locator('.wb-canvas-level')).toHaveText('Organization');
      await expect(other.locator('.wb-org-view [data-position-id]').filter({ hasText: 'Secretary' })).not.toContainText(
        'Bea Placeholder',
      );
    }

    await openOrg(page, 'Primary', true);
    const vacantTeachers = await vacantRows(page, 'Primary Teacher').count();
    await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
    const sheet = personSheet(page, 'Bea Placeholder');
    await expect(sheet).toContainText(`Callings in ${name}`);
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Move from Primary Teacher' }).click();

    const move = page.getByRole('dialog', { name: 'Move Bea Placeholder' });
    await expect(move).toBeVisible();
    await move.getByRole('searchbox', { name: 'Find a calling' }).click();
    await page.keyboard.type('secre');
    await expectNoHorizontalOverflow(page);
    await move.getByRole('button', { name: 'Secretary, Primary · Primary Presidency' }).click();

    await expect(move).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Moved Bea Placeholder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bea Placeholder, Secretary' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' })).toHaveCount(0);
    await expect(vacantRows(page, 'Primary Teacher')).toHaveCount(vacantTeachers + 1);
    await expectNoHorizontalOverflow(page);

    if (other !== null) {
      // No reload: the desktop sees the phone's move live.
      await expect(other.locator('.wb-org-view [data-position-id]').filter({ hasText: 'Secretary' })).toContainText(
        'Bea Placeholder',
      );
    }
  } finally {
    await desktop?.close();
  }
});

test('fill a vacancy from the dugout', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await startProposal(page, uniqueProposalName('Phone fill', testInfo));
  await openOrg(page, 'Ward-wide Callings', true);
  await vacantRows(page, 'Chorister').click();

  const fill = page.getByRole('dialog', { name: 'Fill Chorister' });
  await expect(fill).toBeVisible();
  await expect(fill.getByText('Matches Musical').first()).toBeVisible();
  await fill.getByRole('searchbox', { name: 'Find a person' }).click();
  await page.keyboard.type('ivy');
  await expectNoHorizontalOverflow(page);
  await fill.getByRole('button', { name: 'Ivy Notreal, No calling, Matches Musical' }).click();

  await expect(fill).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Placed Ivy Notreal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ivy Notreal, Chorister' })).toBeVisible();
  await expect(vacantRows(page, 'Chorister')).toHaveCount(0);
});

test('release a calling', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await startProposal(page, uniqueProposalName('Phone release', testInfo));
  await openOrg(page, 'Primary', true);
  const vacantTeachers = await vacantRows(page, 'Primary Teacher').count();
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  await personSheet(page, 'Bea Placeholder').getByRole('button', { name: 'Release from Primary Teacher' }).click();

  await expect(personSheet(page, 'Bea Placeholder')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Released Bea Placeholder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' })).toHaveCount(0);
  await expect(vacantRows(page, 'Primary Teacher')).toHaveCount(vacantTeachers + 1);
});

test('a second calling asks first and fits the phone', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await startProposal(page, uniqueProposalName('Phone second', testInfo));
  await openOrg(page, 'Primary', true);

  // Bea joins the dugout on purpose and keeps her calling.
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const sheet = personSheet(page, 'Bea Placeholder');
  await sheet.getByRole('button', { name: /Add to dugout/ }).click();
  await expect(sheet.getByText('In dugout', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();

  await vacantRows(page, 'Secretary').click();
  const fill = page.getByRole('dialog', { name: 'Fill Secretary' });
  await fill.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();

  const dialog = page.getByRole('dialog', { name: 'Give Bea Placeholder a second calling?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Already serves as Primary Teacher');
  await expectWithinWidth(page, dialog);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Add second calling' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Placed Bea Placeholder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bea Placeholder, Secretary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' })).toBeVisible();
});
