import { expect, test } from '@playwright/test';

/**
 * The proposal summary preview (artboard 7). TV is out of scope for this page:
 * the summary is a desktop/phone screen, so the TV project skips rather than
 * being asserted against.
 */
const isTv = (testInfo: { project: { name: string } }): boolean => testInfo.project.name === 'tv-chromium';

test('preview shows header, all four card headings, divergence heading; no horizontal scroll', async ({ page }, testInfo) => {
  test.skip(isTv(testInfo), 'TV is out of scope for the summary page');

  await page.goto('/__preview/summary');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Header: eyebrow, title, back button, Download CSV. Exact: the preview
  // harness bar also carries the title "Proposal summary".
  await expect(page.getByText('PROPOSAL SUMMARY', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Back to board/u })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();

  // All four cards, each with a count in its heading.
  const cards = page.getByRole('heading', { level: 2 });
  await expect(cards.filter({ hasText: /^\+ Suggested callings · \d+$/u })).toHaveCount(1);
  await expect(cards.filter({ hasText: /^− Suggested releases · \d+$/u })).toHaveCount(1);
  await expect(cards.filter({ hasText: /^Position changes · \d+$/u })).toHaveCount(1);
  await expect(cards.filter({ hasText: /^Remaining vacancies · \d+$/u })).toHaveCount(1);

  // The preview's re-imported Current diverges, so the divergence section
  // renders with its count heading and the "proposal is unchanged" note.
  await expect(page.getByRole('heading', { name: /^Current changed since this baseline · \d+ difference/u })).toBeVisible();
  await expect(page.getByText(/this proposal is unchanged/u)).toBeVisible();

  // No horizontal scroll at any viewport this page runs on.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test('Download CSV click produces the expected filename (desktop)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The download mechanics are checked on desktop only');

  await page.goto('/__preview/summary');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const downloadButton = page.getByRole('button', { name: 'Download CSV' });
  await expect(downloadButton).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
  expect(download.suggestedFilename()).toBe('Spring adjustments.csv');
});
