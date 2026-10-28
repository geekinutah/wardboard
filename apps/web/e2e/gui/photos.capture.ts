import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'photos';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
}

async function expectActionsAtLeast44(page: Page): Promise<void> {
  for (const name of ['Cancel import', 'Keep Current', 'Use New Photo']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    if (box === null) throw new Error(`missing ${name}`);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
}

test('photo comparison dialog', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
    });
  };

  await page.goto('/__preview/photos');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const ada = page.getByRole('dialog', { name: "Replace Ada Fictional's photo?" });
  await expect(ada).toBeVisible();
  await expect(ada.getByRole('heading', { name: "Replace Ada Fictional's photo?" })).toBeVisible();
  await expect(ada.getByText('Directory import · 1 of 2')).toBeVisible();
  await expect(ada.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(ada.getByText('INCOMING', { exact: true })).toBeVisible();
  const current = ada.getByRole('img', { name: 'Current portrait of Ada Fictional' });
  const incoming = ada.getByRole('img', { name: 'Incoming portrait of Ada Fictional' });
  await expect(current).toBeVisible();
  await expect(incoming).toBeVisible();
  const adaCurrentSrc = await current.getAttribute('src');
  expect(adaCurrentSrc).not.toBe(await incoming.getAttribute('src'));
  await expect(ada.getByText('Current portrait', { exact: true })).toBeVisible();
  await expect(ada.getByText('Incoming portrait', { exact: true })).toBeVisible();
  await expect(ada.getByText("2 household images were skipped — they aren't offered as portraits.")).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Cancel import' })).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Keep Current' })).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Use New Photo' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone-')) await expectActionsAtLeast44(page);
  await shot('dialog');

  await ada.getByRole('button', { name: 'Keep Current' }).click();
  const ben = page.getByRole('dialog', { name: "Replace Ben Example's photo?" });
  await expect(ben).toBeVisible();
  await expect(ben.getByText('Directory import · 2 of 2')).toBeVisible();
  await expect(ben.getByRole('img', { name: 'Current portrait of Ben Example' })).toBeVisible();
  await expect(ben.getByRole('img', { name: 'Incoming portrait of Ben Example' })).toBeVisible();
  expect(await ben.getByRole('img', { name: 'Current portrait of Ben Example' }).getAttribute('src')).not.toBe(
    adaCurrentSrc,
  );
  await expectNoHorizontalOverflow(page);
  if (project.startsWith('phone-')) await expectActionsAtLeast44(page);
  await shot('kept');
});
