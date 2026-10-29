import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

/*
 * Person inspector portrait and upload on the integrated board (desktop-chromium
 * only): initials placeholder, portrait after a first upload, and the replacement
 * comparison dialog showing both images. Compared with artboard 14
 * (docs/design/ui-canvas/PhotoCompare.dc.html) and the inspector in Main.dc.html.
 */

const SCENARIO = 'person-photo';
const PERSON = 'Cal Sample';
const ORG = 'Bishopric';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A valid 16x16 solid-colour PNG. */
function solidPng(r: number, g: number, b: number): Buffer {
  const size = 16;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_ONE = solidPng(200, 60, 60);
const PNG_TWO = solidPng(40, 90, 200);

async function expectLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() => image.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0)))
    .toBeGreaterThan(0);
}

async function expectAtLeast44(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('missing box');
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('inspector placeholder, portrait and comparison', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== 'desktop-chromium', 'Photo upload in the inspector is desktop-only; phones get it in T-094');
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`) });
  };

  await page.goto('/?layout=desktop');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByRole('article', { name: ORG }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('.wb-org-card-wrapper', { hasText: PERSON }).click();
  const inspector = page.getByRole('complementary', { name: `Person: ${PERSON}` });
  await expect(inspector).toBeVisible();
  await expect(page.getByRole('img', { name: /^Portrait of/ })).toHaveCount(0);
  const input = page.getByLabel(`Upload photo for ${PERSON}`);
  await input.scrollIntoViewIfNeeded();
  await expectAtLeast44(input);
  const placeholderBox = await inspector.locator('.wb-person-avatar').boundingBox();
  await shot('placeholder');

  await input.setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: PNG_ONE });
  await expect(page.getByText(`Photo added for ${PERSON}`)).toBeVisible();
  const portrait = page.getByRole('img', { name: `Portrait of ${PERSON}` });
  await expect(portrait).toBeVisible();
  await expectLoaded(portrait);
  const portraitBox = await portrait.boundingBox();
  expect(portraitBox?.width).toBe(placeholderBox?.width);
  expect(portraitBox?.height).toBe(placeholderBox?.height);
  await shot('portrait');

  await input.setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: PNG_TWO });
  const dialog = page.getByRole('dialog', { name: `Replace ${PERSON}'s photo?` });
  await expect(dialog).toBeVisible();
  await expectLoaded(dialog.getByRole('img', { name: `Current portrait of ${PERSON}` }));
  await expectLoaded(dialog.getByRole('img', { name: `Incoming portrait of ${PERSON}` }));
  await expectNoHorizontalOverflow(page);
  await shot('compare');
});
