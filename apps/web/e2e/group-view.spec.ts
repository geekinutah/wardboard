import { expect, test } from '@playwright/test';

test('fill the add position form and see the emitted request', async ({ page }) => {
  await page.goto('/__preview/group-view');
  await page.getByRole('button', { name: 'Add position to Relief Society Teachers' }).click();
  await page.getByRole('radio', { name: 'List' }).check();
  await page.getByRole('button', { name: '+', exact: true }).click();
  await page.getByRole('textbox', { name: 'Calling title' }).fill('Teacher');
  await page.getByRole('button', { name: 'Add position', exact: true }).click();
  await expect(page.locator('body')).toContainText('"positionCount":3');
  await expect(page.locator('body')).toContainText('"type":"list"');
  await expect(page.locator('body')).toContainText('"title":"Teacher"');
});
