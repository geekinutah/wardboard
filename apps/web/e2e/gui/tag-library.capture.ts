import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';

const SCENARIO = 'tag-library';

/** Unique across projects, repeats, and retries; never collides with a seeded tag. */
function uniqueTagName(testInfo: TestInfo): string {
  return `E2E tag ${testInfo.project.name} r${String(testInfo.repeatEachIndex)} t${String(testInfo.retry)}`;
}

/** Puts the named tag on one member (picked by `slot`) over the same channel the app uses. */
async function attachTagToMember(page: Page, tagName: string, slot: number): Promise<void> {
  await page.evaluate(
    async ({ name, index }) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      type Msg = Record<string, unknown>;
      const socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
      const next = (match: (m: Msg) => boolean): Promise<Msg> =>
        new Promise((resolve, reject) => {
          const onMessage = (event: MessageEvent): void => {
            const m = JSON.parse(String(event.data)) as Msg;
            if (match(m)) {
              socket.removeEventListener('message', onMessage);
              resolve(m);
            }
          };
          socket.addEventListener('message', onMessage);
          socket.addEventListener('error', () => {
            reject(new Error('socket error'));
          });
        });
      await new Promise<void>((resolve) => {
        socket.onopen = () => {
          resolve();
        };
      });
      const boards = next((m) => m.type === 'boards');
      socket.send(JSON.stringify({ type: 'listBoards' }));
      const current = (await boards).current as { boardId: string };
      const snapshot = next((m) => m.type === 'snapshot');
      socket.send(JSON.stringify({ type: 'subscribe', boardId: current.boardId }));
      const ward = (await snapshot).ward as {
        members: Record<string, { id: string; name: string; tagIds: string[] }>;
        tags: Record<string, { id: string; name: string }>;
      };
      const tag = Object.values(ward.tags).find((t) => t.name === name);
      const members = Object.values(ward.members).sort((a, b) => a.name.localeCompare(b.name));
      const member = members[index % members.length];
      if (tag === undefined || member === undefined) throw new Error('tag or member not found');
      const done = next((m) => m.requestId === 'e2e-tl-update');
      socket.send(
        JSON.stringify({
          type: 'updateMember',
          requestId: 'e2e-tl-update',
          memberId: member.id,
          patch: { tagIds: [...member.tagIds, tag.id] },
        }),
      );
      const reply = await done;
      socket.close();
      if (reply.type !== 'memberUpdated') throw new Error(`updateMember failed: ${JSON.stringify(reply)}`);
    },
    { name: tagName, index: slot },
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectTargetsAtLeast44(locator: Locator): Promise<void> {
  const targets = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { name: node.textContent, height: rect.height, width: rect.width };
    }),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, target.name).toBeGreaterThanOrEqual(44);
    expect(target.width, target.name).toBeGreaterThanOrEqual(44);
  }
}

test('tag library on the Settings page', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string, fullPage = true): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage });
  };
  const name = uniqueTagName(testInfo);
  const slot = ['desktop-chromium', 'phone-chromium', 'phone-webkit', 'tv-chromium'].indexOf(project);

  await page.goto('/settings');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const section = page.getByRole('region', { name: 'Tags' });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Tag library' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot('settings-page');

  await section.getByRole('button', { name: '+ New tag' }).click();
  await page.getByRole('textbox', { name: 'New tag name' }).click();
  await page.keyboard.type(name);
  await page.getByRole('button', { name: 'Save' }).click();
  const row = section.getByRole('row', { name });
  await expect(row).toBeVisible();
  await attachTagToMember(page, name, Math.max(slot, 0));
  await expect(row.getByRole('cell').nth(1)).toHaveText('1');
  await row.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(section.getByRole('button'));
  await shot('tags-section');

  await row.getByRole('button', { name: `Delete ${name}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Removes it from 1 person');
  await expectNoHorizontalOverflow(page);
  await expectTargetsAtLeast44(dialog.getByRole('button'));
  await shot('delete-dialog', false);

  await dialog.getByRole('button', { name: 'Delete tag' }).click();
  await expect(row).toHaveCount(0);
});
