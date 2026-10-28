import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

/*
 * Real-browser drags on /__preview/dnd. Desktop and TV use the mouse. Phone
 * Chromium sends real touch input through the DevTools protocol. Playwright has
 * no touch-move API for WebKit, so phone WebKit dispatches touch-type
 * PointerEvents at the element under each point, the way the browser would.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Pointer {
  down(at: Point): Promise<void>;
  move(to: Point): Promise<void>;
  up(at: Point): Promise<void>;
}

const STEPS = 8;

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
        // Touch pointers are implicitly captured by the element first touched.
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

/** Scrolls so both elements are inside the viewport, and fails if they cannot be. */
async function showBoth(page: Page, first: Locator, second: Locator): Promise<void> {
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (a === null || b === null) {
    throw new Error('drag endpoints are not rendered');
  }
  const top = Math.min(a.y, b.y);
  await page.evaluate((delta) => {
    window.scrollBy(0, delta);
  }, top - 64);
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

function dugoutRow(page: Page, name: string): Locator {
  return page.locator('aside[data-drop-target="dugout"] article[data-member-id]', { hasText: name });
}

function positionCard(page: Page, name: string): Locator {
  return page.locator('[data-position-id][data-member-id]', { hasText: name });
}

function teacherList(page: Page): Locator {
  return page.getByRole('list', { name: 'Relief Society Teacher' });
}

function teacherVacancy(page: Page): Locator {
  return teacherList(page).locator('[data-position-id]:not([data-member-id])').first();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__preview/dnd');
  await expect(page.getByText('Drag a member card onto a calling or the dugout.')).toBeVisible();
});

test('drag from the dugout into a vacancy places the member', async ({ page }, testInfo) => {
  await expect(teacherList(page)).not.toContainText('Ivy Notreal');
  await dragOnto(page, testInfo, dugoutRow(page, 'Ivy Notreal'), teacherVacancy(page));
  await expect(page.getByText('Applied: addToList')).toBeVisible();
  await expect(teacherList(page)).toContainText('Ivy Notreal');
  await expect(dugoutRow(page, 'Ivy Notreal')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('drop on an occupied calling offers Swap', async ({ page }, testInfo) => {
  await dragOnto(page, testInfo, positionCard(page, 'Gwen Imaginary'), positionCard(page, 'Hana Madeup'));
  const dialog = page.getByRole('dialog', { name: 'Second Counselor is filled' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Swap/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByText('Applied: swap')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(positionCard(page, 'Gwen Imaginary')).toContainText('Second Counselor');
  await expect(positionCard(page, 'Hana Madeup')).toContainText('First Counselor');
});

test('out-of-unit member asks for a second calling', async ({ page }, testInfo) => {
  const kai = page.locator('section[aria-labelledby="wb-dnd-preview-outside"] article[data-member-id]');
  await dragOnto(page, testInfo, kai, teacherVacancy(page));
  const dialog = page.getByRole('dialog', { name: 'Give Kai Fictional a second calling?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Serves outside the ward as Stake Young Single Adult Adviser · Example Stake')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add second calling' }).click();
  await expect(page.getByText('Applied: addToList')).toBeVisible();
  await expect(teacherList(page)).toContainText('Kai Fictional');
});

test('Current cannot be dragged', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Show Current' }).click();
  await expect(page.getByText('Current is read-only. Nothing can be dragged here.')).toBeVisible();
  const gwen = positionCard(page, 'Gwen Imaginary');
  const hana = positionCard(page, 'Hana Madeup');
  await showBoth(page, gwen, hana);
  const pointer = await pointerFor(page, testInfo);
  const start = await center(gwen);
  const end = await center(hana);
  await pointer.down(start);
  await pointer.move(end);
  await expect(page.locator('[data-dnd-ghost]')).toHaveCount(0);
  await expect(page.locator('[data-drop-active]')).toHaveCount(0);
  await pointer.up(end);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/^Applied:/)).toHaveCount(0);
  await expect(gwen).toContainText('First Counselor');
  await expect(hana).toContainText('Second Counselor');
});
