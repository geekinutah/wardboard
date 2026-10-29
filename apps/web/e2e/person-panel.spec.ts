import { expect, test, type Page } from '@playwright/test';

type TargetConfig =
  | { kind: 'dugout'; name: string; note: string }
  | { kind: 'canvas'; name: string; orgName: string; note: string };

const FALLBACK_TARGET: TargetConfig = {
  kind: 'dugout',
  name: 'Jay Storybook',
  note: 'Desktop project note: travels for work.',
};

const PROJECT_TARGETS: Record<string, TargetConfig> = {
  'desktop-chromium': {
    kind: 'dugout',
    name: 'Jay Storybook',
    note: 'Desktop project note: travels for work.',
  },
  'phone-chromium': {
    kind: 'dugout',
    name: 'Ivy Notreal',
    note: 'Phone chromium project note: teaches youth.',
  },
  'phone-webkit': {
    kind: 'dugout',
    name: 'Tai Demo',
    note: 'Phone webkit project note: speaks Spanish.',
  },
  'tv-chromium': {
    kind: 'canvas',
    name: 'Ada Fictional',
    orgName: 'Bishopric',
    note: 'TV project note: available Sundays.',
  },
};

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('save a note, reload, and see it only in the notes dialog', async ({ page }, testInfo) => {
  const target: TargetConfig = PROJECT_TARGETS[testInfo.project.name] ?? FALLBACK_TARGET;

  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();

  if (target.kind === 'dugout') {
    // Expand dugout if needed
    const showMore = page.getByRole('button', { name: /Show \d+ more/ });
    if (await showMore.isVisible()) {
      await showMore.click();
    }

    // Find the target member row in the dugout panel
    const memberRow = page.locator('.wb-dugout-row', { hasText: target.name });
    await memberRow.scrollIntoViewIfNeeded();
    await expect(memberRow).toBeVisible();

    // Single-click opens the inspector
    await memberRow.click();
  } else {
    // Zoom into organization on the canvas
    const orgTile = page.locator('.wb-overview-tile', { hasText: target.orgName });
    await expect(orgTile).toBeVisible();
    await orgTile.dblclick();
    await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

    // Click the member's card on the board
    const memberCard = page.locator('.wb-org-card-wrapper', { hasText: target.name });
    await expect(memberCard).toBeVisible();
    await memberCard.click();
  }

  const inspector = page.getByRole('complementary', { name: `Person: ${target.name}` });
  await expect(inspector).toBeVisible();

  // Notes are never rendered in the inspector
  const inspectorText = await inspector.innerText();
  expect(inspectorText).not.toContain(target.note);

  // Click "Open notes" to open the dialog
  await page.getByRole('button', { name: 'Open notes' }).click();
  const dialog = page.getByRole('dialog', { name: `Notes · ${target.name}` });
  await expect(dialog).toBeVisible();

  // Save the new note
  const textarea = page.getByRole('textbox', { name: 'Note' });
  await textarea.fill(target.note);
  await page.getByRole('button', { name: 'Save' }).click();

  // Dialog closes on save
  await expect(dialog).toHaveCount(0);

  // Reload the page from the real server
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();

  // The saved note text must not appear anywhere on the board outside the dialog
  const bodyText = await page.innerText('body');
  expect(bodyText).not.toContain(target.note);

  // Open the notes dialog again to verify persistence
  if (target.kind === 'dugout') {
    const showMore = page.getByRole('button', { name: /Show \d+ more/ });
    if (await showMore.isVisible()) {
      await showMore.click();
    }
    const memberRowAfter = page.locator('.wb-dugout-row', { hasText: target.name });
    await memberRowAfter.scrollIntoViewIfNeeded();
    await memberRowAfter.click();
  } else {
    const orgTileAfter = page.locator('.wb-overview-tile', { hasText: target.orgName });
    await expect(orgTileAfter).toBeVisible();
    await orgTileAfter.dblclick();
    await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');

    const memberCardAfter = page.locator('.wb-org-card-wrapper', { hasText: target.name });
    await expect(memberCardAfter).toBeVisible();
    await memberCardAfter.click();
  }

  await expect(page.getByRole('complementary', { name: `Person: ${target.name}` })).toBeVisible();

  await page.getByRole('button', { name: 'Open notes' }).click();
  const dialogAfter = page.getByRole('dialog', { name: `Notes · ${target.name}` });
  await expect(dialogAfter).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue(target.note);

  // Cancel closes the dialog
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialogAfter).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
});
