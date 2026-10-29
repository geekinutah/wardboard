import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { createProposal, uniqueProposalName } from '../support/proposals.ts';

/*
 * The member tags section in the person inspector (all four viewports) and the
 * level-3 Calling tags panel (desktop and TV) on the integrated board at `/`.
 * It works on its own Draft and its own uniquely named tag. Compared with
 * artboard 10 (docs/design/ui-canvas/Tags.dc.html).
 */

const SCENARIO = 'tags-in-app';

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


test('tags-in-app', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };
  const tag = `Cap ${uniqueTagName(testInfo)}`;
  const name = uniqueProposalName('Tags capture', testInfo);

  await page.goto('/?layout=desktop');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  await page.getByRole('tab', { name }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();

  const person = await selectOwnPerson(page, testInfo, true);
  const section = page.getByRole('region', { name: 'Member tags' });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('inspector-member-tags');

  await section.getByRole('combobox', { name: 'Add a tag' }).fill(tag);
  await page.getByRole('option', { name: `Create tag “${tag}”` }).click();
  await expect(section.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await shot('inspector-member-tag-added');

  if (project.startsWith('phone')) return;

  if (project === 'tv-chromium') {
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const orgTile = page.getByRole('article', { name: GROUP.org });
  await orgTile.scrollIntoViewIfNeeded();
  await orgTile.dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator(`[data-zoom-target^="group:"][aria-label="${GROUP.group}"]`).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');

  const panel = page.getByRole('region', { name: 'Calling tags' });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  await shot('calling-tags-panel');

  await panel.getByRole('button', { name: '+ Preference' }).click();
  await panel.getByRole('combobox', { name: 'Add a preference' }).fill(tag);
  await panel.getByRole('option', { name: new RegExp(tag, 'u') }).click();
  await expect(panel.getByRole('button', { name: `Remove preference ${tag}` })).toBeVisible();
  await panel.getByRole('button', { name: 'Highlight' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Matching:' })).toContainText(person);
  await panel.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await shot('calling-tags-preference-match');
});
