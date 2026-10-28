import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

/*
 * Drag and drop on /__preview/dnd. Desktop and TV drag with the mouse; phone
 * Chromium uses real touch input (DevTools protocol); phone WebKit dispatches
 * touch-type PointerEvents (Playwright has no touch-move API for WebKit).
 */

const SCENARIO = 'dnd';
const STEPS = 8;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Pointer {
  down(at: Point): Promise<void>;
  move(to: Point): Promise<void>;
  up(at: Point): Promise<void>;
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function mousePointer(page: Page): Pointer {
  return {
    async down(at) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
    },
    async move(to) {
      await page.mouse.move(to.x, to.y, { steps: STEPS });
    },
    async up(at) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.up();
    },
  };
}

async function cdpTouchPointer(page: Page): Promise<Pointer> {
  const client = await page.context().newCDPSession(page);
  let last: Point = { x: 0, y: 0 };
  return {
    async down(at) {
      last = at;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    },
    async move(to) {
      const from = last;
      for (let step = 1; step <= STEPS; step += 1) {
        const point = lerp(from, to, step / STEPS);
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y }] });
      }
      last = to;
    },
    async up() {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}

function syntheticTouchPointer(page: Page): Pointer {
  let last: Point = { x: 0, y: 0 };
  const fire = (type: string, at: Point): Promise<void> =>
    page.evaluate(
      ({ type: eventType, x, y }) => {
        const holder = window as unknown as { __dndDownTarget?: Element | null };
        const under = document.elementFromPoint(x, y);
        if (eventType === 'pointerdown') {
          holder.__dndDownTarget = under;
        }
        const target = holder.__dndDownTarget ?? under ?? document.body;
        target.dispatchEvent(
          new PointerEvent(eventType, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            button: eventType === 'pointermove' ? -1 : 0,
            buttons: eventType === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
        if (eventType === 'pointerup') {
          holder.__dndDownTarget = null;
        }
      },
      { type, x: at.x, y: at.y },
    );
  return {
    async down(at) {
      last = at;
      await fire('pointerdown', at);
    },
    async move(to) {
      const from = last;
      for (let step = 1; step <= STEPS; step += 1) {
        await fire('pointermove', lerp(from, to, step / STEPS));
      }
      last = to;
    },
    async up(at) {
      await fire('pointerup', at);
    },
  };
}

async function pointerFor(page: Page, testInfo: TestInfo): Promise<Pointer> {
  switch (testInfo.project.name) {
    case 'phone-chromium':
      return cdpTouchPointer(page);
    case 'phone-webkit':
      return syntheticTouchPointer(page);
    default:
      return mousePointer(page);
  }
}

async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('element has no box');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function showBoth(page: Page, first: Locator, second: Locator): Promise<void> {
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (a === null || b === null) {
    throw new Error('drag endpoints are not rendered');
  }
  await page.evaluate((delta) => {
    window.scrollBy(0, delta);
  }, Math.min(a.y, b.y) - 64);
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('no viewport');
  }
  for (const locator of [first, second]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
  }
}

async function dragOnto(page: Page, testInfo: TestInfo, from: Locator, to: Locator): Promise<void> {
  await showBoth(page, from, to);
  const pointer = await pointerFor(page, testInfo);
  const start = await center(from);
  const end = await center(to);
  await pointer.down(start);
  await pointer.move(end);
  await pointer.up(end);
}

/** Drags onto the dugout panel at a visible point of it, as close to the source as possible. */
async function dragToDugout(page: Page, testInfo: TestInfo, from: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const viewport = page.viewportSize();
  const panel = await page.locator('aside[data-drop-target="dugout"]').boundingBox();
  if (viewport === null || panel === null) {
    throw new Error('no viewport or dugout panel');
  }
  const start = await center(from);
  const top = Math.max(panel.y, 0) + 16;
  const bottom = Math.min(panel.y + panel.height, viewport.height) - 16;
  expect(bottom).toBeGreaterThan(top);
  const end = { x: panel.x + panel.width / 2, y: Math.min(Math.max(start.y, top), bottom) };
  const pointer = await pointerFor(page, testInfo);
  await pointer.down(start);
  await pointer.move(end);
  await pointer.up(end);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

/** Every dialog button is at least 44px, and the dialog fits the viewport. */
async function expectDialogFits(page: Page, dialog: Locator): Promise<void> {
  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  if (viewport === null || box === null) {
    throw new Error('dialog or viewport missing');
  }
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const fits = await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(fits).toBe(true);
  const buttons = await dialog.getByRole('button').evaluateAll((nodes) =>
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
  await expectNoHorizontalScroll(page);
}

function dugoutRow(page: Page, name: string): Locator {
  return page.locator('aside[data-drop-target="dugout"] article[data-member-id]', { hasText: name });
}

function positionCard(page: Page, name: string): Locator {
  return page.locator('[data-position-id][data-member-id]', { hasText: name });
}

function teacherVacancy(page: Page): Locator {
  return page.getByRole('list', { name: 'Relief Society Teacher' }).locator('[data-position-id]:not([data-member-id])').first();
}

async function open(page: Page): Promise<void> {
  await page.goto('/__preview/dnd');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByText('Drag a member card onto a calling or the dugout.')).toBeVisible();
}

test('drag and drop preview', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = false): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };

  // 1. Mid-drag over a vacancy: ghost and "Drop here" visible.
  await open(page);
  await expectNoHorizontalScroll(page);
  const ivy = dugoutRow(page, 'Ivy Notreal');
  const vacancy = teacherVacancy(page);
  await showBoth(page, ivy, vacancy);
  const pointer = await pointerFor(page, testInfo);
  const start = await center(ivy);
  const end = await center(vacancy);
  await pointer.down(start);
  await pointer.move(end);
  await expect(page.locator('[data-dnd-ghost]')).toBeVisible();
  await expect(page.locator('[data-dnd-ghost]')).toContainText('Ivy Notreal');
  await expect(page.getByText('Drop here', { exact: true })).toBeVisible();
  await expect(vacancy).toHaveAttribute('data-drop-active', 'true');
  await expectNoHorizontalScroll(page);
  await shot('mid-drag');
  await pointer.up(end);
  await expect(page.getByText('Applied: addToList')).toBeVisible();

  // 2. Drop dialog: Gwen onto Hana's single calling.
  await open(page);
  await dragOnto(page, testInfo, positionCard(page, 'Gwen Imaginary'), positionCard(page, 'Hana Madeup'));
  const dropDialog = page.getByRole('dialog', { name: 'Second Counselor is filled' });
  await expect(dropDialog).toBeVisible();
  await expect(dropDialog.getByText('Applied as one change for everyone viewing.')).toBeVisible();
  await expectDialogFits(page, dropDialog);
  await shot('drop-dialog');
  await dropDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dropDialog).toHaveCount(0);

  // 3. Second-calling dialog: Kai (serves outside the ward) onto the teacher vacancy.
  await open(page);
  const kai = page.locator('section[aria-labelledby="wb-dnd-preview-outside"] article[data-member-id]');
  await dragOnto(page, testInfo, kai, teacherVacancy(page));
  const secondDialog = page.getByRole('dialog', { name: 'Give Kai Fictional a second calling?' });
  await expect(secondDialog).toBeVisible();
  await expect(
    secondDialog.getByText('The General Handbook 30.1.1 says a member generally serves in only one calling at a time.'),
  ).toBeVisible();
  await expectDialogFits(page, secondDialog);
  await shot('second-calling-dialog');
  await secondDialog.getByRole('button', { name: 'Cancel' }).click();

  // 4. Approval dialog: Cy Mockup (Needs approval) onto the Relief Society Teachers list.
  await open(page);
  await dragOnto(page, testInfo, positionCard(page, 'Cy Mockup'), teacherVacancy(page));
  const approvalDialog = page.getByRole('dialog', { name: 'Approval needed for this placement' });
  await expect(approvalDialog).toBeVisible();
  await expect(approvalDialog.getByRole('button', { name: 'Approve placement' })).toBeDisabled();
  await approvalDialog.getByRole('checkbox').check();
  await expect(approvalDialog.getByRole('button', { name: 'Approve placement' })).toBeEnabled();
  await expectDialogFits(page, approvalDialog);
  await shot('approval-dialog');
  await approvalDialog.getByRole('button', { name: 'Approve placement' }).click();
  await expect(page.getByText('Applied: addToList, approvePlacement')).toBeVisible();

  // 5. After a dugout drop: Lena Storybook's teacher card onto the dugout.
  await open(page);
  await dragToDugout(page, testInfo, positionCard(page, 'Lena Storybook'));
  await expect(page.getByText('Applied: moveToDugout')).toBeVisible();
  const lena = dugoutRow(page, 'Lena Storybook');
  await expect(lena).toBeVisible();
  await expect(lena).toContainText('Placed here');
  await lena.scrollIntoViewIfNeeded();
  await expectNoHorizontalScroll(page);
  await shot('after-dugout-drop');
});
