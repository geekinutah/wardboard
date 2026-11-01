import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './gui/capture-test.ts';

const DESKTOP_ONLY = 'Capture isolation runs on desktop-chromium only';
const LEAK_TAG = 'Leak marker capture';

type WardNames = {
  tagNames: string[];
  memberNames: string[];
};

function skipUnlessDesktop(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'desktop-chromium', DESKTOP_ONLY);
}

async function readSnapshot(page: Page, createTagName: string | null): Promise<WardNames> {
  await page.goto('/');
  return page.evaluate(async (tagName) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    type Msg = Record<string, unknown>;
    const socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
    const next = (match: (message: Msg) => boolean): Promise<Msg> =>
      new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent): void => {
          const message = JSON.parse(String(event.data)) as Msg;
          if (match(message)) {
            socket.removeEventListener('message', onMessage);
            resolve(message);
          }
        };
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', () => {
          reject(new Error('socket error'));
        });
      });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
          resolve();
        });
        socket.addEventListener('error', () => {
          reject(new Error('socket error'));
        });
      });
      const boardsMessage = next((message) => message.type === 'boards');
      socket.send(JSON.stringify({ type: 'listBoards' }));
      const boards = await boardsMessage;
      const current = boards.current as { boardId: string } | null | undefined;
      if (current === null || current === undefined) throw new Error('no Current');
      if (tagName !== null) {
        const created = next((message) => message.requestId === 'e2e-leak-tag');
        socket.send(JSON.stringify({ type: 'createTag', requestId: 'e2e-leak-tag', name: tagName }));
        const reply = await created;
        if (reply.type !== 'tagCreated') throw new Error(`createTag failed: ${JSON.stringify(reply)}`);
      }
      const snapshotMessage = next((message) => message.type === 'snapshot');
      socket.send(JSON.stringify({ type: 'subscribe', boardId: current.boardId }));
      const snapshot = await snapshotMessage;
      const ward = snapshot.ward as {
        members: Record<string, { name: string }>;
        tags: Record<string, { name: string }>;
      };
      return {
        tagNames: Object.values(ward.tags).map((tag) => tag.name),
        memberNames: Object.values(ward.members).map((member) => member.name),
      };
    } finally {
      socket.close();
    }
  }, createTagName);
}

test.describe('seeded scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test('a scenario keeps the tag it just created', async ({ page }, testInfo) => {
    skipUnlessDesktop(testInfo);
    const ward = await readSnapshot(page, LEAK_TAG);
    expect(ward.tagNames).toContain(LEAK_TAG);
  });

  test('the next scenario starts from the fixture seed', async ({ page }, testInfo) => {
    skipUnlessDesktop(testInfo);
    const ward = await readSnapshot(page, null);
    expect(ward.tagNames).not.toContain(LEAK_TAG);
    expect(ward.memberNames).toContain('Ada Fictional');
  });
});

test.describe('unseeded scenario', () => {
  test.use({ captureSeed: false });

  test('an unseeded scenario has no Current', async ({ page }, testInfo) => {
    skipUnlessDesktop(testInfo);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up WardBoard' })).toBeVisible();
    await expect(page.getByText('Ada Fictional')).toHaveCount(0);
  });
});
