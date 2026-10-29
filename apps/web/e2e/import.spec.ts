import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const root = document.documentElement;
    const preview = document.querySelector('.wb-preview-content');
    const importRoot = document.querySelector('.wb-import');
    return {
      doc: root.scrollWidth <= root.clientWidth,
      preview: preview === null || preview.scrollWidth <= preview.clientWidth,
      import: importRoot === null || importRoot.scrollWidth <= importRoot.clientWidth,
    };
  });
  expect(size.doc).toBe(true);
  expect(size.preview).toBe(true);
  expect(size.import).toBe(true);
}

async function expectButtonsAtLeast44(page: Page): Promise<void> {
  const buttons = page.locator('.wb-import button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box, `button ${String(index)}`).not.toBeNull();
    if (box === null) continue;
    expect(box.height, `button ${String(index)}`).toBeGreaterThanOrEqual(44);
  }
}

test('import preview resolves identities before replace', async ({ page }) => {
  const importCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/import')) importCalls.push(request.url());
  });

  await page.goto('/__preview/import');
  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await expect(page.getByText('IMPORT · REPLACE CURRENT')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Import steps' });
  await expect(steps.getByText('1 · Sources')).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toHaveText('2 · Preview');
  await expect(steps.getByText('3 · Photos')).toBeVisible();
  await expect(steps.getByText('4 · Confirm')).toBeVisible();
  await expect(steps.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Callings by Organization, Validated' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Members without Callings, Validated' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Out-of-Unit Callings, Validated' })).toBeVisible();
  await expect(page.getByText('Optional · upload in the app or collect later')).toBeVisible();
  await expect(page.getByText('Not collected yet')).toBeVisible();
  await expect(page.getByRole('article', { name: 'People 2' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Matched positions 12' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Kept positions 4' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Outside-ward callings 0' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Unfamiliar callings 0' })).toBeVisible();
  await expect(page.getByText('[312]')).toHaveCount(0);
  for (const label of ['Phone', 'Email', 'Address', 'Birth date', 'Age', 'Record number', 'Class rosters', 'Ministering']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Replaced Current. Matched 1, created 1, removed 0.')).toHaveCount(0);

  const blocked = page.getByRole('button', { name: 'Resolve 2 identities to continue' });
  await expect(blocked).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await expectButtonsAtLeast44(page);

  const june = page.getByRole('article', { name: 'Lark, June' });
  await june.getByRole('button', { name: 'June Lark' }).click();
  await expect(page.getByRole('button', { name: 'Resolve 1 identity to continue' })).toBeDisabled();
  const otto = page.getByRole('article', { name: 'Pineda, Otto' });
  await otto.getByRole('button', { name: 'Treat as new person' }).click();
  const replace = page.getByRole('button', { name: 'Replace Current' });
  await expect(replace).toBeEnabled();
  await expect(june.getByRole('button', { name: 'June Lark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(otto.getByRole('button', { name: 'Treat as new person' })).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
  await expectButtonsAtLeast44(page);

  await replace.click();
  await expect(page.getByText('Replaced Current. Matched 1, created 1, removed 0.')).toBeVisible();
  expect(importCalls).toEqual([]);
  await expectNoHorizontalOverflow(page);
});
