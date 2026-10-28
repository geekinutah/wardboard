import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
}

test('comparison advances one member at a time and a first photo needs no dialog', async ({ page }) => {
  await page.goto('/__preview/photos');
  const ada = page.getByRole('dialog', { name: "Replace Ada Fictional's photo?" });
  await expect(ada).toBeVisible();
  await expect(ada.getByText('Directory import · 1 of 2')).toBeVisible();
  await expect(ada.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(ada.getByText('INCOMING', { exact: true })).toBeVisible();
  await expect(ada.getByText(/2 household images were skipped/)).toBeVisible();
  const adaCurrent = await ada.getByRole('img', { name: 'Current portrait of Ada Fictional' }).getAttribute('src');
  const adaIncoming = await ada.getByRole('img', { name: 'Incoming portrait of Ada Fictional' }).getAttribute('src');
  expect(adaCurrent).not.toBe(adaIncoming);
  await expectNoHorizontalOverflow(page);

  await ada.getByRole('button', { name: 'Keep Current' }).click();
  const ben = page.getByRole('dialog', { name: "Replace Ben Example's photo?" });
  await expect(ben).toBeVisible();
  await expect(ben.getByText('Directory import · 2 of 2')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Kept the current photo for Ada Fictional.');
  const benCurrent = await ben.getByRole('img', { name: 'Current portrait of Ben Example' }).getAttribute('src');
  expect(benCurrent).not.toBe(adaCurrent);
  await expectNoHorizontalOverflow(page);

  await ben.getByRole('button', { name: 'Use New Photo' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Using the new photo for Ben Example.');
  await expect(page.getByText('Using the new photo for Ben Example.')).toHaveCount(2);

  const input = page.getByLabel('Upload photo for Cal Sample');
  await expect(input).toBeVisible();
  await input.setInputFiles({ name: 'cal.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.wb-photo-upload').getByText('Photo added for Cal Sample')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('cancel import leaves the next member uncompared', async ({ page }) => {
  await page.goto('/__preview/photos');
  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(page.getByRole('status')).toHaveText('Import cancelled.');
  await expect(page.getByRole('heading', { name: "Replace Ben Example's photo?" })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const input = page.getByLabel('Upload photo for Cal Sample');
  await input.setInputFiles({ name: 'notes.png', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByText('Choose a JPEG or PNG.')).toBeVisible();
  await expect(page.getByText('Photo added for Cal Sample')).toHaveCount(0);

  await input.setInputFiles({ name: 'cal.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.wb-photo-upload').getByText('Photo added for Cal Sample')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
