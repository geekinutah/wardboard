import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'phone-shell';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectButtonsAtLeast44(page: Page): Promise<void> {
  const buttons = await page.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height, width: rect.width };
    }),
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.height, button.name).toBeGreaterThanOrEqual(44);
    expect(button.width, button.name).toBeGreaterThanOrEqual(44);
  }
}

test('phone shell preview', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
  };

  await page.goto('/__preview/phone-shell');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // State 1: Board tab
  await expect(page.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeVisible();
  await expect(page.getByText('PROPOSED')).toBeVisible();
  await expect(page.getByText(/\+\d+ callings? · \u2212\d+ releases? · \d+ vacant/)).toBeVisible();
  await expect(page.getByText('Board tab content')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Board sections' });
  const boardTab = nav.getByRole('button', { name: 'Board', exact: true });
  await expect(boardTab).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('board');

  // State 2: Changes tab
  const changesTab = nav.getByRole('button', { name: /Changes/ });
  await changesTab.click();
  await expect(page.getByText('Changes tab content')).toBeVisible();
  await expect(changesTab).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('changes');

  // State 3: Open switcher sheet
  const switcherBtn = page.getByRole('button', { name: /Switch board/i });
  await switcherBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Boards' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2, name: 'Boards' })).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3, name: 'Proposals' })).toBeVisible();
  await expect(dialog.getByText('Current')).toBeVisible();
  await expect(dialog.getByText('Read-only · imported Oct 24')).toBeVisible();
  await expect(dialog.getByText('Spring adjustments')).toBeVisible();
  await expect(dialog.getByText('Viewing')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start proposal' })).toBeVisible();
  await expect(dialog.getByText("Each person picks their own board; switching here never changes anyone else's view.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone')) {
    await expectButtonsAtLeast44(page);
  }
  await shot('switcher');
});
