import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'presentation';

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

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test('presentation preview', async ({ page }, testInfo) => {
  await page.goto('/__preview/presentation');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('heading', { name: 'Show Needs approval off', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Show Needs approval on', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spring adjustments', level: 1 }).first()).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  await expect(page.getByText('Ring = proposed change').first()).toBeVisible();

  const presentations = page.locator('.wb-presentation');
  await expect(presentations).toHaveCount(2);
  await expect(presentations.nth(0)).not.toContainText('Needs approval');
  await expect(presentations.nth(1).getByText('Needs approval').first()).toBeVisible();
  const presentationCount = await presentations.count();
  for (let index = 0; index < presentationCount; index += 1) {
    await expectProposedLeaderVisible(presentations.nth(index));
  }

  const overflow = await pageOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const project = testInfo.project.name;
  if (project.startsWith('phone')) {
    const buttons = await page.getByRole('button', { name: 'Exit presentation' }).evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      }),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.width).toBeGreaterThanOrEqual(44);
    }
  }

  if (project === 'tv-chromium') {
    const count = await presentations.count();
    for (let index = 0; index < count; index += 1) {
      const fit = await presentations.nth(index).evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    }
  }

  await presentations.nth(0).screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${project}.png`),
  });
  await presentations.nth(1).screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${project}-needs-approval.png`),
  });
});
