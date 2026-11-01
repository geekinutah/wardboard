import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { uniqueProposalName } from '../support/proposals.ts';

/*
 * T-101 phone profile and add-position sheets. Bea Placeholder holds Primary
 * Teacher. The capture edits only the Draft it creates.
 */

const SCENARIO = 'phone-profile';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function openOrg(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name},`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('phone profile and add position', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(!project.startsWith('phone'), 'Phone profile and add position apply to the phone projects');
  const shot = async (state: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`) });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();

  await openOrg(page, 'Primary');
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const currentPerson = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(currentPerson.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await currentPerson.getByRole('button', { name: 'Profile, note & photo' }).click();
  const currentProfile = page.getByRole('dialog', { name: 'Profile · Bea Placeholder' });
  await currentProfile.getByRole('textbox', { name: 'Note' }).click();
  await shot('current-profile');
  await currentProfile.getByRole('button', { name: 'Close' }).click();
  await currentPerson.getByRole('button', { name: 'Close' }).click();
  await page.locator('.wb-phone-org-back').click();

  const name = uniqueProposalName('Phone profile capture', testInfo);
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const start = page.getByRole('dialog', { name: 'Start a proposal' });
  await start.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await start.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await openOrg(page, 'Primary');
  await expect(page.getByText('Tap a person for options · tap a vacancy to fill it')).toBeVisible();
  await page.getByRole('button', { name: 'Add a position to Primary Teachers', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a position to Primary Teachers' });
  await expect(add.getByRole('combobox', { name: 'Gender requirement' })).toBeVisible();
  await add.getByRole('textbox', { name: 'Calling title' }).fill('Fictional Helper');
  await shot('add-position');
  await add.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  await page.getByRole('dialog', { name: /^Bea Placeholder/ }).getByRole('button', { name: 'Profile, note & photo' }).click();
  const profile = page.getByRole('dialog', { name: 'Profile · Bea Placeholder' });
  const note = profile.getByRole('textbox', { name: 'Note' });
  await note.fill('Fictional planning note');
  await note.click();
  await shot('profile-note');
});
