import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'design-gallery';

test('design-gallery', async ({ page, baseURL }, testInfo) => {
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const serverHost = new URL(baseURL ?? 'http://127.0.0.1').host;
  const external: string[] = [];

  // Same-origin only: self-hosted fonts must not reach a CDN.
  page.on('request', (request) => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      external.push(request.url());
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.host !== serverHost) external.push(request.url());
  });

  await page.goto('/__gallery');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page.getByRole('article', { name: 'Ada Fictional' })).toBeVisible();
  await expect(page.getByText('Vacant').first()).toBeVisible();
  await expect(page.getByText('Removed from Current').first()).toBeVisible();
  await expect(page.getByText('Position removed from Current')).toBeVisible();
  await expect(page.getByText('Needs approval').first()).toBeVisible();
  await expect(page.getByText('+ Proposed').first()).toBeVisible();
  await expect(page.getByText('\u2212').first()).toBeVisible();
  await expect(page.getByText('REMOVED', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('POSITION REMOVED', { exact: true })).toBeVisible();

  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });

  // Compare against the root element's clientWidth, not window.innerWidth.
  // Mobile-emulated Chromium widens innerWidth to the content width.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(external).toEqual([]);
});
