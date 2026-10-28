import { expect, test, type Page } from '@playwright/test';

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

test('opens Current, switches to the fixture proposal, zooms to a group, adds a position and sees it committed', async ({
  page,
}, testInfo) => {
  const title = `Fictional Chorister ${testInfo.project.name}`;
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

  await page.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(page.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with its baseline')).toBeVisible();
  await expect(page.getByText(/\+ \d+ suggested callings/)).toBeVisible();
  await expect(page.getByText(/\u2212 \d+ suggested releases/)).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Ward');

  await openTeachers(page);
  await expect(page.getByRole('searchbox', { name: 'Search people, callings, tags' })).toBeVisible();
  await page.getByRole('button', { name: 'Add position to Relief Society Teachers' }).click();
  await page.getByRole('textbox', { name: 'Calling title' }).fill(title);
  // One DOM click. Playwright's retried click can submit again after the button unmounts.
  await page.getByRole('button', { name: 'Add position', exact: true }).evaluate((element: HTMLElement) => {
    element.click();
  });

  await expect(page.getByRole('article', { name: `Vacant, ${title}` })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await expectNoHorizontalOverflow(page);
});
