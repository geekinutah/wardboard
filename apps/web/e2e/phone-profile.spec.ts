import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { uniqueProposalName } from './support/proposals.ts';

/*
 * T-101: profile sheet and add position on the phone Board tab.
 * Fixture member Bea Placeholder holds Primary Teacher. Each editing test
 * creates its own Draft and does not edit Current.
 */

const SKIP_REASON = 'Phone profile and add position apply to the phone projects';
const TARGET_NOTE = 'Fictional planning note';
const INTERIM_NOTE = 'Fictional interim note';
const NOTE_LOCK = path.join(tmpdir(), 'wardboard-t101-bea-note.lock');

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

/** Bea's note is ward-wide, so the two phone projects must not save it at once. */
async function withBeaNoteLock(body: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 45_000;
  for (;;) {
    try {
      await mkdir(NOTE_LOCK);
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      try {
        const info = await stat(NOTE_LOCK);
        if (Date.now() - info.mtimeMs > 90_000) {
          await rm(NOTE_LOCK, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The other project released the lock between the failed create and this stat.
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting to save the shared fixture note', { cause: error });
      }
      await delay(100);
    }
  }
  try {
    await body();
  } finally {
    await rm(NOTE_LOCK, { recursive: true, force: true });
  }
}

async function openBeaProfile(page: Page): Promise<void> {
  const person = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  if ((await person.count()) === 0) {
    await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  }
  const profile = page.getByRole('dialog', { name: 'Profile · Bea Placeholder' });
  if ((await profile.count()) === 0) {
    await page.getByRole('dialog', { name: /^Bea Placeholder/ }).getByRole('button', { name: 'Profile, note & photo' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Profile · Bea Placeholder' })).toBeVisible();
}

async function saveOpenNote(page: Page, note: string): Promise<void> {
  const profile = page.getByRole('dialog', { name: 'Profile · Bea Placeholder' });
  await profile.getByRole('textbox', { name: 'Note' }).fill(note);
  await profile.getByRole('button', { name: 'Save' }).click();
  await expect(profile).toHaveCount(0);
}

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

async function openCurrent(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
}

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

async function openOrg(page: Page, name: string, editable: boolean): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name},`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const hint = editable ? 'Tap a person for options · tap a vacancy to fill it' : 'This board is read-only';
  await expect(page.getByText(hint)).toBeVisible();
}

test('a draft can add a position without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await startProposal(page, uniqueProposalName('Phone profile add', testInfo));
  await openOrg(page, 'Primary', true);
  await page.getByRole('button', { name: 'Add a position to Primary Teachers', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a position to Primary Teachers' });
  await sheet.getByRole('textbox', { name: 'Calling title' }).fill('Fictional Helper');
  await expect(sheet.getByRole('combobox', { name: 'Gender requirement' })).toHaveValue('any');
  await sheet.getByRole('button', { name: 'Add position', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vacant, Fictional Helper', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a profile note is still there when the sheet is opened again', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  test.setTimeout(90_000);
  await startProposal(page, uniqueProposalName('Phone profile note', testInfo));
  await openOrg(page, 'Primary', true);
  await withBeaNoteLock(async () => {
    await openBeaProfile(page);
    const profile = page.getByRole('dialog', { name: 'Profile · Bea Placeholder' });
    if ((await profile.getByRole('textbox', { name: 'Note' }).inputValue()) === TARGET_NOTE) {
      await saveOpenNote(page, INTERIM_NOTE);
      await page.getByRole('dialog', { name: /^Bea Placeholder/ }).getByRole('button', { name: 'Close' }).click();
      await openBeaProfile(page);
    }
    await saveOpenNote(page, TARGET_NOTE);
    await page.getByRole('dialog', { name: /^Bea Placeholder/ }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: /^Bea Placeholder/ })).toHaveCount(0);

    await openBeaProfile(page);
    await expect(page.getByRole('dialog', { name: 'Profile · Bea Placeholder' }).getByRole('textbox', { name: 'Note' })).toHaveValue(
      TARGET_NOTE,
    );
    await expectNoHorizontalOverflow(page);
  });
});

test('Current opens profile and has no move or add position', async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), SKIP_REASON);
  await startProposal(page, uniqueProposalName('Phone profile locked', testInfo));
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: /^Current/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();
  await openOrg(page, 'Primary', false);
  await expect(page.getByRole('button', { name: 'Add a position to Primary Teachers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const sheet = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(sheet.getByRole('button', { name: 'Profile, note & photo' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
