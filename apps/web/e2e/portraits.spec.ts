import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';

/*
 * Stored portraits replace the initials avatar on the ward overview, the
 * organization and group cards and presentation mode, live (T-100).
 *
 * This spec uploads real photos to the suite's shared server, so the people
 * are chosen to be asserted by no other spec or capture (grep of e2e/ for each
 * name and for the initials FP, UD, LS, KN, WN found nothing) and are distinct
 * per project so the desktop and TV runs never touch the same member:
 *   desktop-chromium  leader Faye Pretend (Relief Society president),
 *                     group member Lena Storybook (Relief Society Teachers)
 *   tv-chromium       leader Uma Demo (Young Women president),
 *                     group member Kit Notreal (Relief Society Teachers)
 * Wren Notreal (a Young Women leader) never gets a photo and keeps initials.
 * person-photo.spec.ts uses Ben Example only.
 */

const PEOPLE: Record<string, { leader: string; org: string; member: string }> = {
  'desktop-chromium': { leader: 'Faye Pretend', org: 'Relief Society', member: 'Lena Storybook' },
  'tv-chromium': { leader: 'Uma Demo', org: 'Young Women', member: 'Kit Notreal' },
};
const GROUP = 'Relief Society Teachers';
const UNPHOTOGRAPHED = 'Wren Notreal';

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

const PNG = solidPng(200, 60, 60);

async function openPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({
    ...(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL }),
    viewport: testInfo.project.use.viewport ?? { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return page;
}

async function expectLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() => image.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0)))
    .toBeGreaterThan(0);
}

async function upload(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('complementary', { name: `Person: ${name}` })).toBeVisible();
  await page.getByLabel(`Upload photo for ${name}`).setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(`Photo added for ${name}`)).toBeVisible();
}

function overviewSlot(page: Page, name: string): Locator {
  return page.locator('.wb-overview-leader').filter({ hasText: name });
}

test('a stored portrait replaces the initials on the overview, cards and presentation', async ({ browser }, testInfo) => {
  const people = PEOPLE[testInfo.project.name];
  test.skip(people === undefined, 'Phone portraits are out of scope for T-100');
  if (people === undefined) return;

  const editor = await openPage(browser, testInfo);
  const watcher = await openPage(browser, testInfo);

  // The watcher stays on the ward overview and never reloads.
  await expect(overviewSlot(watcher, people.leader).locator('.wb-overview-avatar')).toBeVisible();
  await expect(overviewSlot(watcher, people.leader).locator('img')).toHaveCount(0);
  await expect(overviewSlot(watcher, UNPHOTOGRAPHED).locator('.wb-overview-avatar')).toBeVisible();

  // 1. First photo for the leader through the inspector (no comparison).
  await editor.getByRole('article', { name: people.org }).dblclick();
  await expect(editor.locator('.wb-canvas-level')).toHaveText('Organization');
  await editor.locator('.wb-org-card-wrapper', { hasText: people.leader }).click();
  await upload(editor, people.leader);
  await expect(editor.getByRole('dialog')).toHaveCount(0);

  // 2. The other client shows the portrait on its ward overview, loaded, without a reload.
  const overviewImg = overviewSlot(watcher, people.leader).locator('img.wb-overview-avatar-photo');
  await expect(overviewImg).toBeVisible();
  await expectLoaded(overviewImg);
  await expect(overviewImg).toHaveAttribute('src', /^\/api\/photos\//);
  // A member without a photo still shows initials.
  await expect(overviewSlot(watcher, UNPHOTOGRAPHED).locator('img')).toHaveCount(0);
  await expect(overviewSlot(watcher, UNPHOTOGRAPHED).locator('.wb-overview-avatar')).not.toBeEmpty();

  // 3. The organization card and a group card show portraits.
  const orgCard = editor.locator('.wb-org-card-wrapper', { hasText: people.leader }).locator('img.wb-avatar-photo');
  await expect(orgCard).toBeVisible();
  await expectLoaded(orgCard);
  // The group lives in Relief Society; start again from the ward overview.
  await editor.goto('/?layout=desktop');
  await expect(editor.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await editor.getByRole('article', { name: 'Relief Society' }).dblclick();
  await expect(editor.locator('.wb-canvas-level')).toHaveText('Organization');
  await editor.locator(`[data-zoom-target^="group:"][aria-label="${GROUP}"]`).dblclick();
  await expect(editor.locator('.wb-canvas-level')).toHaveText('Group');
  await editor.locator('.wb-group-card', { hasText: people.member }).click();
  await upload(editor, people.member);
  const groupImg = editor.locator('.wb-group-card', { hasText: people.member }).locator('img.wb-avatar-photo');
  await expect(groupImg).toBeVisible();
  await expectLoaded(groupImg);
  const unphotographed = editor.locator('.wb-group-card', { hasText: 'Jo Testwell' });
  await expect(unphotographed.locator('img')).toHaveCount(0);
  await expect(unphotographed.locator('.wb-avatar')).not.toBeEmpty();

  // 4. Presentation mode shows the leader's portrait.
  await watcher.getByRole('button', { name: 'Present' }).click();
  await expect(watcher.locator('.wb-presentation')).toBeVisible();
  const leader = watcher.locator('.wb-presentation-leader').filter({ hasText: people.leader });
  const presentationImg = leader.locator('img.wb-presentation-avatar');
  await expect(presentationImg).toBeVisible();
  await expectLoaded(presentationImg);
  const box = await presentationImg.boundingBox();
  expect(box?.width).toBe(box?.height);
  // 5. A leader without a photo keeps initials.
  const plain = watcher.locator('.wb-presentation-leader').filter({ hasText: UNPHOTOGRAPHED });
  await expect(plain.locator('img')).toHaveCount(0);
  await expect(plain.locator('.wb-presentation-avatar')).not.toBeEmpty();

  await editor.context().close();
  await watcher.context().close();
});
