import { expect, test, type Locator, type Page } from '@playwright/test';

async function openGallery(page: Page): Promise<Locator> {
  await page.goto('/__gallery');
  const section = page.getByRole('region', { name: 'Canvas', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('.wb-canvas-level')).toHaveText('Ward');
  return section;
}

function levelLabel(section: Locator): Locator {
  return section.locator('.wb-canvas-level');
}

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test('double-click tile, then group, then Esc twice', async ({ page }) => {
  const section = await openGallery(page);
  const level = levelLabel(section);

  await section.locator('[data-zoom-target="org:primary"]').dblclick();
  await expect(level).toHaveText('Organization');

  await section.locator('[data-zoom-target="group:teachers"]').dblclick();
  await expect(level).toHaveText('Group');

  await section.locator('.wb-canvas').focus();
  await page.keyboard.press('Escape');
  await expect(level).toHaveText('Organization');

  await section.locator('.wb-canvas').focus();
  await page.keyboard.press('Escape');
  await expect(level).toHaveText('Ward');
});

test('mouse wheel zooms in over a tile until level 2', async ({ page }, testInfo) => {
  const section = await openGallery(page);
  const level = levelLabel(section);
  const primary = section.locator('[data-zoom-target="org:primary"]');
  await primary.scrollIntoViewIfNeeded();
  const box = await primary.boundingBox();
  if (box === null) throw new Error('Primary tile has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Playwright rejects page.mouse.wheel on mobile WebKit. Dispatch the same bubbling wheel.
  if (testInfo.project.name === 'phone-webkit') {
    await primary.dispatchEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true });
  } else {
    const layer = section.locator('.wb-canvas-layer');
    const snapshot = async (): Promise<string> => {
      const text = await level.textContent();
      const style = await layer.getAttribute('style');
      return `${text ?? ''}|${style ?? ''}`;
    };
    // Phone Chromium reports deltaY / deviceScaleFactor, so one notch may stay at Ward.
    // Wait until each wheel is painted before the next, and stop at Organization.
    let seen = await snapshot();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if ((await level.textContent()) === 'Organization') break;
      await page.mouse.wheel(0, -500);
      await expect.poll(snapshot).not.toBe(seen);
      seen = await snapshot();
    }
  }

  await expect(level).toHaveText('Organization');
});

test('Fit ward from level 3', async ({ page }) => {
  const section = await openGallery(page);
  const level = levelLabel(section);

  await section.locator('[data-zoom-target="org:primary"]').dblclick();
  await expect(level).toHaveText('Organization');
  await section.locator('[data-zoom-target="group:teachers"]').dblclick();
  await expect(level).toHaveText('Group');

  await section.getByRole('button', { name: 'Fit ward' }).click();
  await expect(level).toHaveText('Ward');
  await expect(section.locator('[data-zoom-target="org:primary"]')).toBeVisible();
});

test('no horizontal page scroll at any viewport', async ({ page }) => {
  await openGallery(page);
  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
