import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir, startCheckoutServer, type CheckoutServer } from '../checkout-server.ts';

const SCENARIO = 'photo-bundle';

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

async function expectTargetsAtLeast44(locator: Locator): Promise<void> {
  const targets = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height };
    }),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, target.name ?? undefined).toBeGreaterThanOrEqual(44);
  }
}

test('photo bundle gui capture', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({
      path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`),
      fullPage: true,
    });
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
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const section = page.locator('.wb-photo-bundle-section');
  await expect(section.getByRole('heading', { name: 'Directory photos', level: 2 })).toBeVisible();

  // 1. Upload bundle and view matches screen
  await section.getByLabel('Photo bundle files').setInputFiles([
    { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: pngFileName, mimeType: 'image/png', buffer: PNG },
    { name: jpgFileName, mimeType: 'image/jpeg', buffer: JPG },
  ]);

  await section.getByRole('button', { name: 'Review photo bundle' }).click();
  await expect(section.getByRole('heading', { name: 'Review photo matches', level: 3 })).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.locator('button'));
  await shot('preview');

  // Assign ambiguous candidate
  await section.getByRole('button', { name: 'Assign to Xena Storybook' }).click();
  // Import photos (first photos applied)
  await section.getByRole('button', { name: 'Import photos' }).click();
  await expect(section.getByText('Imported directory photos: 2 added, 0 replaced, 0 kept.')).toBeVisible();

  // 2. Upload replacement bundle to capture comparison dialog
  await section.getByRole('button', { name: 'Import another bundle' }).click();
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
  await section.getByRole('button', { name: 'Import photos' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('compare');

  // Complete review
  await dialog.getByRole('button', { name: 'Use New Photo' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(section.getByText('Imported directory photos: 0 added, 1 replaced, 0 kept.')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await shot('done');
});
