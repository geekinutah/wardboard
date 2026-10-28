import { expect, test, type Locator } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Spread of the light-blue proposed ring, in CSS pixels. Zero is not a ring. */
function ringPad(shadow: string): number {
  const colorFirst =
    /156,\s*193,\s*242(?:,\s*[\d.]+)?\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/u.exec(shadow);
  const colorLast =
    /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+rgba?\(\s*156,\s*193,\s*242/u.exec(shadow);
  const match = colorFirst ?? colorLast;
  if (match === null) {
    throw new Error(`proposed ring shadow missing: ${shadow}`);
  }
  const offsetX = Number(match[1]);
  const offsetY = Number(match[2]);
  const spread = Number(match[4]);
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(spread) || spread <= 0) {
    throw new Error(`proposed ring shadow is not a visible spread: ${shadow}`);
  }
  return Math.max(Math.abs(offsetX), Math.abs(offsetY)) + spread;
}

function expectInside(inner: Box, outer: Box, pad: number): void {
  expect(inner.width).toBeGreaterThan(0);
  expect(inner.height).toBeGreaterThan(0);
  expect(inner.x - pad).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y - pad).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.width + pad).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
  expect(inner.y + inner.height + pad).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
}

/** The proposed ring and the word Proposed are painted inside the leader card. */
async function expectProposedLeaderVisible(presentation: Locator): Promise<void> {
  const leaders = presentation.locator('.wb-presentation-leader').filter({
    has: presentation.page().locator('.wb-presentation-proposed'),
  });
  await expect(leaders).toHaveCount(1);
  const leader = leaders.first();
  const label = leader.locator('.wb-presentation-proposed');
  const ring = leader.locator('.wb-presentation-avatar-proposed');
  const name = leader.locator('.wb-presentation-name');
  const role = leader.locator('.wb-presentation-role');
  await expect(label).toBeVisible();
  await expect(label).toHaveText('Proposed');
  await expect(ring).toBeVisible();
  await expect(name).toBeVisible();
  await expect(role).toBeVisible();

  const measured = await leader.evaluate((node) => {
    function boxOf(el: Element): { x: number; y: number; width: number; height: number } {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    const tile = node.closest('.wb-presentation-tile');
    const root = node.closest('.wb-presentation');
    const ringEl = node.querySelector('.wb-presentation-avatar-proposed');
    const labelEl = node.querySelector('.wb-presentation-proposed');
    const nameEl = node.querySelector('.wb-presentation-name');
    const roleEl = node.querySelector('.wb-presentation-role');
    if (tile === null || root === null || ringEl === null || labelEl === null || nameEl === null || roleEl === null) {
      return null;
    }
    const ringStyle = getComputedStyle(ringEl);
    const labelStyle = getComputedStyle(labelEl);
    return {
      shadow: ringStyle.boxShadow,
      labelColor: labelStyle.color,
      labelSize: Number.parseFloat(labelStyle.fontSize),
      initials: ringEl.textContent.trim(),
      nameText: nameEl.textContent.trim(),
      roleText: roleEl.textContent.trim(),
      tile: boxOf(tile),
      root: boxOf(root),
      ring: boxOf(ringEl),
      label: boxOf(labelEl),
      name: boxOf(nameEl),
      role: boxOf(roleEl),
    };
  });
  expect(measured).not.toBeNull();
  if (measured === null) {
    return;
  }
  const pad = ringPad(measured.shadow);
  expect(measured.labelColor.replaceAll(' ', '')).toContain('156,193,242');
  expect(measured.labelSize).toBeGreaterThanOrEqual(24);
  expect(measured.initials.length).toBeGreaterThan(0);
  expect(measured.nameText.length).toBeGreaterThan(0);
  expect(measured.roleText.length).toBeGreaterThan(0);
  expectInside(measured.tile, measured.root, 0);
  expectInside(measured.ring, measured.tile, pad);
  expectInside(measured.label, measured.tile, 0);
  expectInside(measured.name, measured.tile, 0);
  expectInside(measured.role, measured.tile, 0);
}

test('TV viewport renders without scroll at 1920×1080 for the fixture; phone has no horizontal scroll', async ({
  page,
}, testInfo) => {
  await page.goto('/__preview/presentation');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 }).first()).toBeVisible();
  await expect(page.getByText('PROPOSED').first()).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const presentations = page.locator('.wb-presentation');
  await expect(presentations).toHaveCount(2);
  const count = await presentations.count();
  for (let index = 0; index < count; index += 1) {
    await expectProposedLeaderVisible(presentations.nth(index));
  }

  if (testInfo.project.name !== 'tv-chromium') {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const fit = await presentations.nth(index).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        width: rect.width,
        height: rect.height,
      };
    });
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    expect(fit.width).toBeGreaterThan(1800);
    expect(fit.width).toBeLessThanOrEqual(1920);
    expect(fit.height).toBeGreaterThan(1000);
    expect(fit.height).toBeLessThanOrEqual(1080);
  }
});
