import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'shell';

test('shell', async ({ page }, testInfo) => {
  await page.goto('/?layout=desktop');
  await expect(page.getByRole('main').getByText('Server: ok')).toBeVisible();

  // Project names are `<viewport>-<browser>` (docs/gui-verification.md).
  await page.screenshot({
    path: path.join(guiArtifactsDir, SCENARIO, `${testInfo.project.name}.png`),
    fullPage: true,
  });
});
