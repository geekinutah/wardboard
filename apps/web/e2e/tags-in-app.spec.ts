import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createProposal, uniqueProposalName } from './support/proposals.ts';

/*
 * Member and calling tags on the integrated board, against the real checkout
 * server. Tags are ward-wide, so the tag name is unique per project, repeat and
 * retry. The test edits only a Draft it creates itself (T-084).
 */

/*
 * Member tags are ward-wide and an update replaces the whole tag list, so
 * projects running in parallel must each edit a different person.
 */
const PEOPLE: Record<string, string> = {
  'desktop-chromium': 'Jay Storybook',
  'phone-chromium': 'Ivy Notreal',
  'phone-webkit': 'Tai Demo',
  'tv-chromium': 'Ada Fictional',
};
const TV_ORG = 'Bishopric';
const GROUP = { org: 'Relief Society', group: 'Relief Society Teachers' };

function uniqueTagName(testInfo: TestInfo): string {
  return `Tag ${testInfo.project.name} r${String(testInfo.repeatEachIndex)} t${String(testInfo.retry)}`;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function openDraft(page: Page, testInfo: TestInfo, prefix: string): Promise<string> {
  const name = uniqueProposalName(prefix, testInfo);
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  return name;
}

/** The project's own person, ending with the inspector open and the person in the dugout. */
async function selectOwnPerson(page: Page, testInfo: TestInfo, inDugout: boolean): Promise<string> {
  const person = PEOPLE[testInfo.project.name] ?? 'Jay Storybook';
  if (testInfo.project.name === 'tv-chromium') {
    // Not in the seeded dugout: open the card from the canvas.
    await page.getByRole('article', { name: TV_ORG }).dblclick();
    await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
    await page.locator('.wb-org-card-wrapper', { hasText: person }).click();
    await expect(page.getByRole('complementary', { name: `Person: ${person}` })).toBeVisible();
    if (inDugout) {
      await page.getByRole('button', { name: 'Add to dugout' }).click();
      await expect(page.getByRole('complementary', { name: /^Dugout/ })).toContainText(person);
    }
    return person;
  }
  const dugout = page.getByRole('complementary', { name: /^Dugout/ });
  const row = dugout.locator('article[data-member-id]').filter({ hasText: person });
  await expect(dugout.locator('article[data-member-id]').first()).toBeVisible();
  if ((await row.count()) === 0) await dugout.getByRole('button', { name: /^Show \d+ more$/ }).click();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.getByRole('complementary', { name: `Person: ${person}` })).toBeVisible();
  return person;
}

test('create and attach a member tag, reload, and see it persist', async ({ page }, testInfo) => {
  const tag = uniqueTagName(testInfo);
  const draft = await openDraft(page, testInfo, 'Tags member');
  const person = await selectOwnPerson(page, testInfo, false);

  const inspector = page.getByRole('complementary', { name: `Person: ${person}` });
  await expect(inspector.getByRole('heading', { level: 2, name: person })).toHaveCount(1);
  const section = page.getByRole('region', { name: 'Member tags' });
  await expect(section).toBeVisible();
  await section.getByRole('combobox', { name: 'Add a tag' }).fill(tag);
  await page.getByRole('option', { name: `Create tag “${tag}”` }).click();
  await expect(section.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByRole('tab', { name: draft }).click();
  await selectOwnPerson(page, testInfo, false);
  await expect(
    page.getByRole('region', { name: 'Member tags' }).getByRole('button', { name: `Remove tag ${tag}` }),
  ).toBeVisible();
});

test('add a calling preference at level 3 and see the dugout match line', async ({ page }, testInfo) => {
  const tag = `Pref ${uniqueTagName(testInfo)}`;
  await openDraft(page, testInfo, 'Tags calling');

  // Give a dugout member the tag, so the preference has a match.
  const person = await selectOwnPerson(page, testInfo, true);
  const section = page.getByRole('region', { name: 'Member tags' });
  await section.getByRole('combobox', { name: 'Add a tag' }).fill(tag);
  await page.getByRole('option', { name: `Create tag “${tag}”` }).click();
  await expect(section.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();

  if (testInfo.project.name === 'tv-chromium') {
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  }
  await page.getByRole('article', { name: GROUP.org }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator(`[data-zoom-target^="group:"][aria-label="${GROUP.group}"]`).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');

  const panel = page.getByRole('region', { name: 'Calling tags' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Calling' })).toBeVisible();
  await panel.getByRole('button', { name: '+ Preference' }).click();
  await panel.getByRole('combobox', { name: 'Add a preference' }).fill(tag);
  await panel.getByRole('option', { name: new RegExp(tag, 'u') }).click();
  await expect(panel.getByRole('button', { name: `Remove preference ${tag}` })).toBeVisible();
  await expect(panel).toContainText('in the dugout match a preference');
  await panel.getByRole('button', { name: 'Highlight' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Matching:' })).toContainText(person);
  await expectNoHorizontalOverflow(page);
});
