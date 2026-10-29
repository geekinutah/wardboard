import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { uniqueProposalName } from '../support/proposals.ts';

/*
 * T-094 phone sheets on the live board. Fixture ward: Bea Placeholder holds
 * Primary Teacher (tagged Teaches well, which Gospel Doctrine Teacher and Elders
 * Quorum Instructor prefer); Cy Mockup is marked Needs approval; Ivy Notreal
 * (Musical) is in the dugout; Chorister (prefers Musical) and Primary
 * Presidency Secretary are vacant. Only the proposal created here is edited.
 */

const SCENARIO = 'phone-editing';

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

test('phone sheets on the live board', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(!project.startsWith('phone'), 'Phone sheets apply to the phone projects');
  const shot = async (state: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`) });
  };

  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Current' })).toBeVisible();

  // Current: the sheet is read-only.
  await openOrg(page, 'Primary');
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const currentSheet = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(currentSheet).toContainText('Callings in Current');
  await shot('read-only-sheet');
  await currentSheet.getByRole('button', { name: 'Close' }).click();
  await page.locator('.wb-phone-org-back').click();

  // A new Draft.
  const name = uniqueProposalName('Phone sheets capture', testInfo);
  await page.getByRole('button', { name: /Switch board/ }).click();
  await page.getByRole('dialog', { name: 'Boards' }).getByRole('button', { name: 'Start proposal' }).click();
  const start = page.getByRole('dialog', { name: 'Start a proposal' });
  await start.getByRole('textbox', { name: 'Name' }).click();
  await page.keyboard.type(name);
  await start.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await openOrg(page, 'Primary');
  await expect(page.getByText('Tap a person for options · tap a vacancy to fill it')).toBeVisible();
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const sheet = page.getByRole('dialog', { name: /^Bea Placeholder/ });
  await expect(sheet.getByRole('button', { name: 'Move from Primary Teacher' })).toBeVisible();
  await shot('person-sheet');

  await sheet.getByRole('button', { name: 'Move from Primary Teacher' }).click();
  const move = page.getByRole('dialog', { name: 'Move Bea Placeholder' });
  await move.getByRole('searchbox', { name: 'Find a calling' }).click();
  await page.keyboard.type('teach');
  await expect(move.getByText('Matches Teaches well').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await shot('move-sheet');
  await move.getByRole('button', { name: 'Cancel' }).click();

  // Approval for a needs-approval member (cancelled; nothing is sent).
  await page.getByRole('button', { name: 'Cy Mockup, Primary Teacher' }).click();
  await page.getByRole('dialog', { name: /^Cy Mockup/ }).getByRole('button', { name: 'Move from Primary Teacher' }).click();
  await page.getByRole('dialog', { name: 'Move Cy Mockup' }).getByRole('button', { name: 'Secretary, Primary · Primary Presidency' }).click();
  const approval = page.getByRole('dialog', { name: 'Approval needed for this placement' });
  await expect(approval).toBeVisible();
  await shot('approval');
  await approval.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'Move Cy Mockup' }).getByRole('button', { name: 'Cancel' }).click();

  // Bea joins the dugout on purpose and keeps her calling.
  await page.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  await sheet.getByRole('button', { name: /Add to dugout/ }).click();
  await expect(sheet.getByText('In dugout', { exact: true })).toBeVisible();
  await shot('in-dugout');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Vacant, Secretary', exact: true }).click();
  const fill = page.getByRole('dialog', { name: 'Fill Secretary' });
  await expect(fill.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' })).toBeVisible();
  await shot('fill-sheet');
  await fill.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }).click();
  const second = page.getByRole('dialog', { name: 'Give Bea Placeholder a second calling?' });
  await expect(second).toBeVisible();
  await shot('second-calling');
  await second.getByRole('button', { name: 'Add second calling' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Placed Bea Placeholder' })).toBeVisible();
  await shot('placed');

  // A musical match in the fill sheet.
  await page.locator('.wb-phone-org-back').click();
  await openOrg(page, 'Ward-wide Callings');
  await page.getByRole('button', { name: 'Vacant, Chorister', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fill Chorister' }).getByText('Matches Musical').first()).toBeVisible();
  await shot('fill-matches');
});
