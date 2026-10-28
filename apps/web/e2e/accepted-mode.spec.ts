import { expect, test, type Page } from '@playwright/test';
import { createProposal, uniqueProposalName } from './support/proposals.ts';

/*
 * Accepting a proposal in the app (SPEC §3), on the real checkout server. The
 * test accepts and reopens only a Draft it creates itself, never the seed
 * proposal or Current (T-084). The Draft gets one calling over the operation
 * channel first, so the frozen summary has a bishopric block to show.
 */

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

test('accept a Draft, copy the summary, and reopen it to Draft', async ({ page, context }, testInfo) => {
  const name = uniqueProposalName('Accept', testInfo);
  const canCopy = testInfo.project.name === 'desktop-chromium';
  if (canCopy) await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await createProposal(page, name);
  await addOneCalling(page, name);
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Status' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  const status = page.getByRole('combobox', { name: 'Status' });
  await expect(status).toHaveValue('draft');
  await expect(page.getByRole('option', { name: 'Accepted (read-only)' })).toBeEnabled();

  await status.selectOption('accepted');
  await expect(page.getByText(/Accepted .* by .* · read-only/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Callings & releases by bishopric member' })).toBeVisible();
  const blocks = page.locator('.wb-accepted-group');
  await expect(blocks.first()).toBeVisible();
  await expect(blocks.filter({ hasText: 'Ivy Notreal' }).first()).toBeVisible();

  if (canCopy) {
    await page.getByRole('button', { name: 'Copy all' }).click();
    await expect(page.getByRole('button', { name: 'Copied' }).first()).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('Ivy Notreal');
  }

  await status.selectOption('draft');
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(page.locator('.wb-accepted-group')).toHaveCount(0);

  await page.getByRole('button', { name: '← Back to board' }).click();
  await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
  await expect(page.locator('.wb-canvas-level')).toBeVisible();
  await expect(page.locator('.wb-dnd-surface')).toHaveAttribute(
    'data-dnd-enabled',
    testInfo.project.name.startsWith('phone') ? 'false' : 'true',
  );
});
