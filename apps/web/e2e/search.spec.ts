import { expect, test } from '@playwright/test';
import { buildFixtureWard } from '@wardboard/core/fixtures';

function memberIdNamed(name: string): string {
  const { ward } = buildFixtureWard();
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`no fixture member named ${name}`);
  }
  return found.id;
}

test('type Ada, add that person to the dugout, and see the emitted request', async ({ page }) => {
  const ada = memberIdNamed('Ada Fictional');
  await page.goto('/__preview/search');
  await expect(page.getByRole('heading', { name: 'Read-only', level: 2 })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search people, callings, tags' }).first();
  await search.fill('Ada');
  await page.getByRole('button', { name: 'Add to dugout' }).click();
  await expect(page.locator('body')).toContainText(`{"memberId":"${ada}"}`);
  await expect(page.getByText(/warning/i)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
