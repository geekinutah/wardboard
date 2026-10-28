import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('change oversight in the preview and see the emitted JSON; no horizontal scroll', async ({ page }) => {
  await page.goto('/__preview/aaronic');
  await expect(page.getByRole('heading', { name: 'Priests Quorum' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const teachers = page.getByRole('region', { name: 'Teachers Quorum' });
  await teachers.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('radio', { name: 'Second Counselor' }).check();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.locator('body')).toContainText('"kind":"callingGroup"');
  await expect(page.locator('body')).toContainText('"overseer":"second_counselor"');
  await expectNoHorizontalScroll(page);
});
