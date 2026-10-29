import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { startCheckoutServer, type CheckoutServer } from './checkout-server.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x80, 0xff, 0xd9,
]);

test.describe.configure({ mode: 'serial' });

let server: CheckoutServer;

test.beforeAll(async () => {
  server = await startCheckoutServer();
});

test.afterAll(async () => {
  await server.stop();
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('photo bundle import flow in Settings', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'phone-chromium',
    'Photo bundle import runs on desktop-chromium and phone-chromium',
  );
  const phone = testInfo.project.name === 'phone-chromium';
  const checkOverflow = async (): Promise<void> => {
    if (phone) await expectNoHorizontalOverflow(page);
  };

  const pngStem = createHash('sha256').update(PNG).digest('hex');
  const pngFileName = `${pngStem}.png`;

  const jpgStem = createHash('sha256').update(JPG).digest('hex');
  const jpgFileName = `${jpgStem}.jpg`;

  const manifest = {
    format: 'wardboard-photo-bundle',
    version: 1,
    layoutVersion: '2026.1',
    portraits: [
      { name: 'Vera Testwell', file: pngFileName, duplicateName: false },
      { name: 'Xena Storybook', file: jpgFileName, duplicateName: true },
    ],
    missing: [],
    skippedHousehold: 2,
  };

  await page.goto(`${server.url}/settings`);
  const section = page.locator('.wb-photo-bundle-section');
  await expect(section.getByRole('heading', { name: 'Directory photos', level: 2 })).toBeVisible();
  await checkOverflow();

  // 1. Upload initial bundle
  await section.getByLabel('Photo bundle files').setInputFiles([
    { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: pngFileName, mimeType: 'image/png', buffer: PNG },
    { name: jpgFileName, mimeType: 'image/jpeg', buffer: JPG },
  ]);
  await expect(section.getByText('3 files selected')).toBeVisible();
  await checkOverflow();

  await section.getByRole('button', { name: 'Review photo bundle' }).click();
  await expect(section.getByRole('heading', { name: 'Review photo matches', level: 3 })).toBeVisible();
  await checkOverflow();

  // Import button is disabled until ambiguous match is confirmed
  const importBtn = section.getByRole('button', { name: 'Import photos' });
  await expect(importBtn).toBeDisabled();

  // Confirm ambiguous match for Xena Storybook
  const assignBtn = section.getByRole('button', { name: 'Assign to Xena Storybook' });
  await expect(assignBtn).toHaveAttribute('aria-pressed', 'false');
  await assignBtn.click();
  await expect(assignBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(importBtn).toBeEnabled();

  // Import photos (first photos applied immediately)
  await importBtn.click();
  await expect(section.getByText('Imported directory photos: 2 added, 0 replaced, 0 kept.')).toBeVisible();
  await expect(
    section.getByText('pnpm --filter @wardboard/collector run collect -- --staging <staging-dir> --cleanup'),
  ).toBeVisible();
  await checkOverflow();

  // 2. Now upload a second bundle replacing Vera's photo to test comparison review
  const anotherBtn = section.getByRole('button', { name: 'Import another bundle' });
  await expect(anotherBtn).toBeVisible();
  await anotherBtn.click();

  const replaceManifest = {
    format: 'wardboard-photo-bundle',
    version: 1,
    layoutVersion: '2026.1',
    portraits: [
      { name: 'Vera Testwell', file: jpgFileName, duplicateName: false },
    ],
    missing: [],
    skippedHousehold: 1,
  };

  await section.getByLabel('Photo bundle files').setInputFiles([
    { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replaceManifest)) },
    { name: jpgFileName, mimeType: 'image/jpeg', buffer: JPG },
  ]);
  await section.getByRole('button', { name: 'Review photo bundle' }).click();
  await expect(section.getByRole('heading', { name: 'Review photo matches', level: 3 })).toBeVisible();
  await expect(section.getByText('Replaces existing photo')).toBeVisible();

  await section.getByRole('button', { name: 'Import photos' }).click();

  // Comparison dialog appears
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Replace Vera Testwell's photo?")).toBeVisible();
  await expect(dialog.getByText('Directory import · 1 of 1')).toBeVisible();
  await expect(dialog.getByText("1 household image was skipped — it isn't offered as a portrait.")).toBeVisible();
  await checkOverflow();

  await dialog.getByRole('button', { name: 'Use New Photo' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(section.getByText('Imported directory photos: 0 added, 1 replaced, 0 kept.')).toBeVisible();
  await expect(
    section.getByText('pnpm --filter @wardboard/collector run collect -- --staging <staging-dir> --cleanup'),
  ).toBeVisible();
  await checkOverflow();
});
