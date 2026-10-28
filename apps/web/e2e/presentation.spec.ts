import { expect, test } from '@playwright/test';

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

  if (testInfo.project.name !== 'tv-chromium') {
    return;
  }

  const presentations = page.locator('.wb-presentation');
  await expect(presentations).toHaveCount(2);
  const count = await presentations.count();
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
