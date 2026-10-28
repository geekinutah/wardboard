import { expect, test, type Page, type TestInfo } from '@playwright/test';

/** Unique across projects, repeats, and retries; never collides with a seeded tag. */
export function uniqueTagName(testInfo: TestInfo): string {
  return `E2E tag ${testInfo.project.name} r${String(testInfo.repeatEachIndex)} t${String(testInfo.retry)}`;
}

/** Puts the named tag on one member (picked by `slot`) over the same channel the app uses. */
export async function attachTagToMember(page: Page, tagName: string, slot: number): Promise<void> {
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

test('create a tag in Settings, attach it to one person, see the count, delete it', async ({ page }, testInfo) => {
  const name = uniqueTagName(testInfo);
  const slot = ['desktop-chromium', 'phone-chromium', 'phone-webkit', 'tv-chromium'].indexOf(testInfo.project.name);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const section = page.getByRole('region', { name: 'Tags' });
  await expect(section.getByRole('heading', { name: 'Tag library' })).toBeVisible();

  await section.getByRole('button', { name: '+ New tag' }).click();
  await page.getByRole('textbox', { name: 'New tag name' }).click();
  await page.keyboard.type(name);
  await page.getByRole('button', { name: 'Save' }).click();
  const row = section.getByRole('row', { name });
  await expect(row).toBeVisible();

  // One member per project and repeat: repeats run in parallel, and each attach is a
  // read-modify-write of the member's tags, so a shared member would lose updates.
  await attachTagToMember(page, name, Math.max(slot, 0) + 4 * testInfo.repeatEachIndex);
  await expect(row.getByRole('cell').nth(1)).toHaveText('1');

  await row.getByRole('button', { name: `Delete ${name}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Removes it from 1 person');
  await dialog.getByRole('button', { name: 'Delete tag' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Tags' }).getByRole('button', { name: '+ New tag' })).toBeVisible();
  await expect(page.getByRole('row', { name })).toHaveCount(0);
});
