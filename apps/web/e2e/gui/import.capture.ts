import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'import';

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

test('import review', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/import');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Review before replacing Current' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve 2 identities to continue' })).toBeDisabled();
  await expect(page.getByText('Replaced Current. Matched 1, created 1, removed 0.')).toHaveCount(0);
  await expect(page.getByText('Phone', { exact: true })).toBeVisible();
  await expect(page.getByText('Ministering', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone-')) await expectButtonsAtLeast44(page);
  await shot('review');

  const june = page.getByRole('article', { name: 'Lark, June' });
  await june.getByRole('button', { name: 'June Lark' }).click();
  const otto = page.getByRole('article', { name: 'Pineda, Otto' });
  await otto.getByRole('button', { name: 'Treat as new person' }).click();
  await expect(page.getByRole('button', { name: 'Replace Current' })).toBeEnabled();
  await expect(june.getByRole('button', { name: 'June Lark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(otto.getByRole('button', { name: 'Treat as new person' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Replaced Current. Matched 1, created 1, removed 0.')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone-')) await expectButtonsAtLeast44(page);
  await shot('ready');
});
