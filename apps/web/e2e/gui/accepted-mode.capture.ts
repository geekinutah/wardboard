import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { guiArtifactsDir } from '../checkout-server.ts';
import { createProposal, uniqueProposalName } from '../support/proposals.ts';

/*
 * The accepted view on the integrated app at `/`: the Draft state (Accepted
 * option available) and the frozen summary after accepting. It works on a Draft
 * it creates, so the seed proposal and Current are never edited.
 */

const SCENARIO = 'accepted-mode';

/** Places Ivy Notreal (dugout) into the first vacant single position of the new Draft. */
async function addOneCalling(page: Page, name: string): Promise<void> {
  await page.evaluate(async (proposalName) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
      let boardId: string | null = null;
      let subscribed = false;
      const fail = (reason: string): void => {
        socket.close();
        reject(new Error(reason));
      };
      socket.onerror = () => {
        fail('socket error');
      };
      socket.onmessage = (event) => {
        interface Snap {
          type?: string;
          requestId?: string;
          boardId?: string;
          version?: number;
          proposals?: { name: string; boardId: string }[];
          ward: { members: Record<string, { id: string; name: string }> };
          board: {
            positions: Record<string, { id: string; assignmentId: string }>;
            placements: Record<string, string | undefined>;
            assignments: Record<string, { type: string }>;
          };
        }
        const message = JSON.parse(String(event.data)) as Snap;
        if (message.type === 'boards' && !subscribed) {
          const found = (message.proposals ?? []).find((p) => p.name === proposalName);
          if (found === undefined) return;
          subscribed = true;
          boardId = found.boardId;
          socket.send(JSON.stringify({ type: 'subscribe', boardId }));
        } else if (message.type === 'snapshot' && message.boardId === boardId) {
          const board = message.board;
          const ivy = Object.values(message.ward.members).find(
            (m) => m.name === 'Ivy Notreal',
          );
          const vacant = Object.values(board.positions).find(
            (p) => board.placements[p.id] === undefined && board.assignments[p.assignmentId]?.type === 'single',
          );
          if (ivy === undefined || vacant === undefined) {
            fail('no Ivy or no vacancy');
            return;
          }
          socket.send(
            JSON.stringify({
              type: 'op',
              requestId: 'e2e-accepted-edit',
              boardId,
              baseVersion: message.version,
              op: { kind: 'placeInPosition', request: { memberId: ivy.id, from: null, to: vacant.id } },
            }),
          );
        } else if (message.requestId === 'e2e-accepted-edit') {
          socket.close();
          if (message.type === 'committed') resolve();
          else reject(new Error(`edit failed: ${JSON.stringify(message)}`));
        }
      };
    });
  }, name);
}

test('accepted-mode', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const shot = async (state: string): Promise<void> => {
    await page.screenshot({ path: path.join(guiArtifactsDir, SCENARIO, `${state}-${project}.png`), fullPage: true });
  };

  const name = uniqueProposalName('Accept capture', testInfo);
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  await addOneCalling(page, name);
  await page.getByRole('tab', { name }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await shot('board-with-status-button');

  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await shot('draft');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('accepted');
  await expect(page.locator('.wb-accepted-group').filter({ hasText: 'Ivy Notreal' }).first()).toBeVisible();
  await shot('accepted');
});
