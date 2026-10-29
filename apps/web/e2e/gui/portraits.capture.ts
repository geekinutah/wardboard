import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { createProposal, uniqueProposalName } from '../support/proposals.ts';

/*
 * Stored portraits on the integrated board (T-100): ward overview leader,
 * organization card, group card, dugout row and presentation (including a
 * proposed leader with a portrait), on desktop-chromium; presentation again on
 * tv-chromium. Compared with Main, OrgDetail, Zoom, Presentation and Aaronic
 * artboards in docs/design/ui-canvas/.
 *
 * Uploads real photos, so people are asserted by no other capture and differ
 * per project (the capture server is shared by parallel scenarios):
 *   desktop-chromium  Faye Pretend, Lena Storybook, Jay Storybook (dugout)
 *   tv-chromium       Uma Demo,     Kit Notreal,    Tai Demo (dugout)
 */

const SCENARIO = 'portraits';
const PEOPLE: Record<string, { leader: string; org: string; member: string; dugout: string; seatOrg: string }> = {
  'desktop-chromium': { leader: 'Faye Pretend', org: 'Relief Society', member: 'Lena Storybook', dugout: 'Jay Storybook', seatOrg: 'Sunday School' },
  'tv-chromium': { leader: 'Uma Demo', org: 'Young Women', member: 'Kit Notreal', dugout: 'Tai Demo', seatOrg: 'Sunday School' },
};
const GROUP = 'Relief Society Teachers';

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

/**
 * A valid 30x40 (portrait, not square) PNG with a diagonal gradient and a dark
 * bar across the middle, so a stretched or squashed crop is visible.
 */
function gradientPng(seed: number): Buffer {
  const width = 30;
  const height = 40;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const pixels: number[] = [0];
    for (let x = 0; x < width; x += 1) {
      const bar = y >= 18 && y < 22;
      pixels.push(
        bar ? 30 : (seed + x * 6) % 256,
        bar ? 30 : (90 + y * 4) % 256,
        bar ? 30 : (200 - x * 3 - y * 2 + 256) % 256,
      );
    }
    rows.push(Buffer.from(pixels));
  }
  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let seedCounter = 0;
function nextPng(): Buffer {
  seedCounter += 70;
  return gradientPng(seedCounter);
}

async function expectLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() => image.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0)))
    .toBeGreaterThan(0);
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/?layout=desktop');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

async function upload(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('complementary', { name: `Person: ${name}` })).toBeVisible();
  await page.getByLabel(`Upload photo for ${name}`).setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: nextPng() });
  await expect(page.getByText(`Photo added for ${name}`)).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

/** A portrait is the same size as the initials avatars beside it, and square. */
async function expectSameSize(portrait: Locator, initials: Locator): Promise<void> {
  const a = await portrait.boundingBox();
  const b = await initials.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a?.width).toBeCloseTo(b?.width ?? -1, 0);
  expect(a?.height).toBeCloseTo(b?.height ?? -1, 0);
  expect(a?.width).toBeCloseTo(a?.height ?? -1, 0);
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function followTarget(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    const box = await target.boundingBox();
    if (box === null) throw new Error('target has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await expect(target).toHaveAttribute('data-drop-active', 'true', { timeout: 500 });
  }).toPass();
}

async function mouseDrag(page: Page, source: Locator, target: Locator): Promise<void> {
  const to = await centerOf(target);
  const from = await centerOf(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('[data-dnd-ghost]')).toBeVisible();
  await followTarget(page, target);
  await page.mouse.up();
}

test('portraits on the overview, cards, dugout and presentation', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const people = PEOPLE[project];
  test.skip(people === undefined, 'Phone portraits are out of scope for T-100');
  if (people === undefined) return;
  const shot = async (state: string, target: Page | Locator = page): Promise<void> => {
    await target.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`) });
  };

  // Give three people a portrait through the inspector.
  await openApp(page);
  await page.getByRole('article', { name: people.org }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  await page.locator('.wb-org-card-wrapper', { hasText: people.leader }).click();
  await upload(page, people.leader);

  await openApp(page);
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await page.locator(`[data-zoom-target^="group:"][aria-label="${GROUP}"]`).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  await page.locator('.wb-group-card', { hasText: people.member }).click();
  await upload(page, people.member);

  await openApp(page);
  const dugoutPanel = page.getByRole('complementary', { name: /^Dugout/ });
  await dugoutPanel.locator('article[data-member-id]').filter({ hasText: people.dugout }).click();
  await upload(page, people.dugout);

  // Ward overview.
  await openApp(page);
  const slot = page.locator('.wb-overview-leader').filter({ hasText: people.leader });
  const overviewImg = slot.locator('img.wb-overview-avatar-photo');
  await expect(overviewImg).toBeVisible();
  await expectLoaded(overviewImg);
  await expectSameSize(overviewImg, page.locator('.wb-overview-leader').filter({ hasText: 'Wren Notreal' }).locator('.wb-overview-avatar'));
  await expectNoHorizontalOverflow(page);
  if (project === 'desktop-chromium') await shot('ward-overview');

  // Dugout: portrait is not tinted or overlaid with initials.
  const dugoutRow = dugoutPanel.locator('article[data-member-id]').filter({ hasText: people.dugout });
  const dugoutImg = dugoutRow.locator('img.wb-avatar-photo');
  await expect(dugoutImg).toBeVisible();
  await expectLoaded(dugoutImg);
  const otherRows = dugoutPanel.locator('article[data-member-id]').filter({ hasNotText: people.dugout });
  await expectSameSize(dugoutImg, otherRows.first().locator('.wb-avatar'));
  const rowHeights = await dugoutPanel.locator('article[data-member-id]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(rowHeights.length).toBeGreaterThan(1);
  if (project === 'desktop-chromium') await shot('dugout', dugoutPanel);

  // Organization.
  await page.getByRole('article', { name: people.org }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  const orgImg = page.locator('.wb-org-card-wrapper', { hasText: people.leader }).locator('img.wb-avatar-photo');
  await expect(orgImg).toBeVisible();
  await expectLoaded(orgImg);
  await expectSameSize(orgImg, page.locator('.wb-org-card-wrapper:not(:has(img.wb-avatar-photo)) .wb-avatar').first());
  if (project === 'desktop-chromium') await shot('organization');

  // Group detail.
  await openApp(page);
  await page.getByRole('article', { name: 'Relief Society' }).dblclick();
  await page.locator(`[data-zoom-target^="group:"][aria-label="${GROUP}"]`).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Group');
  const groupImg = page.locator('.wb-group-card', { hasText: people.member }).locator('img.wb-avatar-photo');
  await expect(groupImg).toBeVisible();
  await expectLoaded(groupImg);
  await expectSameSize(groupImg, page.locator('.wb-group-card:not(:has(img.wb-avatar-photo)) .wb-avatar').first());
  if (project === 'desktop-chromium') await shot('group-detail');

  // A proposed leader with a portrait: drag the dugout person into a vacant leadership seat.
  const name = uniqueProposalName('Portraits', testInfo);
  await createProposal(page, name);
  await openApp(page);
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'true');
  await page.getByRole('article', { name: people.seatOrg }).dblclick();
  await expect(page.locator('.wb-canvas-level')).toHaveText('Organization');
  const vacant = page.getByRole('region', { name: 'Leadership' }).locator('[data-position-id]', { hasText: 'Vacant' }).first();
  await expect(vacant).toBeVisible();
  const seatId = await vacant.getAttribute('data-position-id');
  const seat = page.locator(`.wb-org-view [data-position-id="${seatId ?? ''}"]`);
  await mouseDrag(page, dugoutRow, seat);
  await expect(seat).toContainText(people.dugout);

  // Presentation, with the proposed ring around the portrait.
  await page.getByRole('button', { name: 'Present' }).click();
  const presentation = page.locator('.wb-presentation');
  await expect(presentation).toBeVisible();
  const proposed = presentation.locator('.wb-presentation-leader').filter({ hasText: people.dugout });
  const ring = proposed.locator('img.wb-presentation-avatar-proposed');
  await expect(ring).toBeVisible();
  await expectLoaded(ring);
  const shadow = await ring.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toMatch(/156,\s*193,\s*242/u);
  const leaderImg = presentation.locator('.wb-presentation-leader').filter({ hasText: people.leader }).locator('img.wb-presentation-avatar');
  await expect(leaderImg).toBeVisible();
  await expectLoaded(leaderImg);
  await expectSameSize(leaderImg, presentation.locator('.wb-presentation-leader').filter({ hasText: 'Wren Notreal' }).locator('.wb-presentation-avatar'));
  await expectSameSize(ring, leaderImg);
  const fit = await presentation.evaluate((el) => ({ w: el.scrollWidth - el.clientWidth, h: el.scrollHeight - el.clientHeight }));
  expect(fit.w).toBeLessThanOrEqual(0);
  await shot('presentation');
});
