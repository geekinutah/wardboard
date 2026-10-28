import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProposal, uniqueProposalName } from './support/proposals.ts';

const STALE_NOTICE =
  'Someone else changed this board first. Your change was not applied; the board has been refreshed.';

/** The client does not retry a stale add, so the test resubmits only after a rejection. */
const MAX_ADD_ATTEMPTS = 8;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function openTeachers(page: Page): Promise<void> {
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]').dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
}

async function vacancyLabel(page: Page): Promise<string> {
  const text = await page.locator('.shell-count-vacant').textContent();
  return text?.trim() ?? '';
}

async function submitAddOnce(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Add position to Relief Society Teachers' }).click();
  await page.getByRole('textbox', { name: 'Calling title' }).fill(title);
  // One DOM click. Playwright's retried click can submit again after the button unmounts.
  await page.getByRole('button', { name: 'Add position', exact: true }).evaluate((element: HTMLElement) => {
    element.click();
  });
}

async function dismissNotice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Dismiss' }).evaluate((element: HTMLElement) => {
    element.click();
  });
}

async function addOutcome(article: Locator, stale: Locator): Promise<'committed' | 'stale' | 'pending'> {
  const present = await article.count();
  if (present >= 1) return 'committed';
  if (present === 0 && (await stale.count()) > 0) return 'stale';
  return 'pending';
}

/** Resubmit only after a stale rejection. A committed add is sent once. */
async function addPositionUntilCommitted(page: Page, title: string): Promise<void> {
  const article = page.getByRole('article', { name: `Vacant, ${title}` });
  const stale = page.getByRole('alert').filter({ hasText: STALE_NOTICE });

  for (let attempt = 0; attempt < MAX_ADD_ATTEMPTS; attempt += 1) {
    const before = await vacancyLabel(page);
    await submitAddOnce(page, title);
    await expect.poll(async () => addOutcome(article, stale)).not.toBe('pending');
    if ((await article.count()) >= 1) return;

    await expect(article).toHaveCount(0);
    await expect(stale).toBeVisible();
    // The notice is set before the refreshed snapshot. Wait for that board, then retry.
    await expect.poll(async () => vacancyLabel(page)).not.toBe(before);
    await dismissNotice(page);
    await expect(stale).toHaveCount(0);
  }
}

test('opens Current, switches to its own proposal, zooms to a group, adds a position and sees it committed', async ({
  page,
}, testInfo) => {
  const proposalName = uniqueProposalName('Shell', testInfo);
  // Unique per repeat: addOutcome treats any existing `Vacant, <title>` article as committed.
  const title = uniqueProposalName('Fictional Chorister', testInfo);
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();
  await expect(page.getByRole('banner').getByText('WardBoard')).toBeVisible();
  await expect(page.getByRole('banner').getByText('E2E Editor')).toBeVisible();
  await expect(page.getByRole('banner').getByText('Admin')).toBeVisible();

  const current = page.getByRole('tab', { name: /Current imported [A-Z][a-z]{2}\s+\d{1,2}/ });
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(page.getByText(/Imported [A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/)).toBeVisible();
  await expect(page.getByText(/\d+ vacant positions/)).toBeVisible();
  await expect(page.getByText(/suggested callings/)).toHaveCount(0);
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');
  await expect(page.getByRole('searchbox', { name: 'Search people, callings, tags' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await createProposal(page, proposalName);
  const proposal = page.getByRole('tab', { name: proposalName, exact: true });
  await proposal.scrollIntoViewIfNeeded();
  await proposal.click();
  await expect(proposal).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with its baseline')).toBeVisible();
  await expect(page.getByText(/\+ \d+ suggested callings/)).toBeVisible();
  await expect(page.getByText(/\u2212 \d+ suggested releases/)).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');

  await openTeachers(page);
  await expect(page.getByRole('searchbox', { name: 'Search people, callings, tags' })).toBeVisible();
  await addPositionUntilCommitted(page, title);

  // Rebuilt from testInfo, not `title`, so a title that drops the repeat index fails here.
  await expect(
    page.getByRole('article', { name: `Vacant, ${uniqueProposalName('Fictional Chorister', testInfo)}` }),
  ).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await expectNoHorizontalOverflow(page);
});
