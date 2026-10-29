import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

/*
 * Portrait and photo upload in the desktop person inspector, against the real
 * checkout server: a first photo, ward-wide propagation to a second client and
 * to another board, then replacement through the comparison dialog (T-093).
 * Ben Example is inspected by no other integrated spec (photos.spec uses a preview page).
 */

const PERSON = 'Ben Example';
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

async function openPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({
    ...(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL }),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return page;
}

async function selectPerson(page: Page): Promise<void> {
  await page.getByRole('article', { name: ORG }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('.wb-org-card-wrapper', { hasText: PERSON }).click();
  await expect(page.getByRole('complementary', { name: `Person: ${PERSON}` })).toBeVisible();
}

function portrait(page: Page) {
  return page.getByRole('img', { name: `Portrait of ${PERSON}` });
}

async function expectLoaded(image: ReturnType<typeof portrait>): Promise<void> {
  await expect
    .poll(() => image.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0)))
    .toBeGreaterThan(0);
}

test('first photo, ward-wide propagation, then replacement through the comparison', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Photo upload in the inspector is desktop-only; phones get it in T-094',
  );

  const a = await openPage(browser, testInfo);
  const b = await openPage(browser, testInfo);
  await selectPerson(a);
  await selectPerson(b);
  await expect(portrait(a)).toHaveCount(0);
  await expect(portrait(b)).toHaveCount(0);

  // 1. A first photo needs no comparison and reaches the other client live.
  await a.getByLabel(`Upload photo for ${PERSON}`).setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: PNG_ONE });
  await expect(a.getByText(`Photo added for ${PERSON}`)).toBeVisible();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(portrait(b)).toBeVisible();
  await expectLoaded(portrait(b));
  const firstSrc = await portrait(b).getAttribute('src');
  expect(firstSrc).toMatch(/^\/api\/photos\//);

  // 2. The photo is ward-wide: a Draft shows it too.
  await b.getByRole('tab', { name: 'Spring adjustments' }).click();
  await expect(b.getByText('PROPOSED', { exact: true })).toBeVisible();
  await selectPerson(b);
  await expect(portrait(b)).toBeVisible();
  await expect(portrait(b)).toHaveAttribute('src', firstSrc ?? '');

  // 3. A replacement is compared; Keep Current changes nothing.
  const upload = a.getByLabel(`Upload photo for ${PERSON}`);
  await upload.setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: PNG_TWO });
  const dialog = a.getByRole('dialog', { name: `Replace ${PERSON}'s photo?` });
  await expect(dialog.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(dialog.getByText('INCOMING', { exact: true })).toBeVisible();
  await expectLoaded(dialog.getByRole('img', { name: `Current portrait of ${PERSON}` }));
  await expectLoaded(dialog.getByRole('img', { name: `Incoming portrait of ${PERSON}` }));
  await dialog.getByRole('button', { name: 'Keep Current' }).click();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(portrait(b)).toHaveAttribute('src', firstSrc ?? '');

  // 4. Use New Photo replaces it everywhere.
  await upload.setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: PNG_TWO });
  await a.getByRole('dialog', { name: `Replace ${PERSON}'s photo?` }).getByRole('button', { name: 'Use New Photo' }).click();
  await expect(a.getByText(`Using the new photo for ${PERSON}.`)).toBeVisible();
  await expect.poll(() => portrait(b).getAttribute('src')).not.toBe(firstSrc);
  await expectLoaded(portrait(b));

  await a.context().close();
  await b.context().close();
});
