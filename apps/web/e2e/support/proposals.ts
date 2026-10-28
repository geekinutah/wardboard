import type { Page, TestInfo } from '@playwright/test';

/** Server `validateMeta` refuses a name longer than this. */
const MAX_PROPOSAL_NAME = 80;

/**
 * Unique across Playwright projects, `--repeat-each` indexes, and retries.
 * A retry, or a server that already holds this name, must not reuse it.
 */
export function uniqueProposalName(prefix: string, testInfo: TestInfo): string {
  const name = `${prefix} ${testInfo.project.name} r${String(testInfo.repeatEachIndex)} t${String(testInfo.retry)}`;
  if (Array.from(name).length > MAX_PROPOSAL_NAME) {
    throw new Error(`proposal name exceeds ${String(MAX_PROPOSAL_NAME)} characters: ${name}`);
  }
  return name;
}

/** Starts a Draft proposal from Current through the same channel the app uses. */
export async function createProposal(page: Page, name: string): Promise<void> {
  await page.evaluate(async (proposalName) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'createProposal',
            requestId: 'e2e-editing-create',
            name: proposalName,
            rationale: null,
            source: { kind: 'current' },
          }),
        );
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type?: string; requestId?: string };
        if (message.requestId !== 'e2e-editing-create') return;
        socket.close();
        if (message.type === 'proposalCreated') resolve();
        else reject(new Error(`createProposal failed: ${JSON.stringify(message)}`));
      };
      socket.onerror = () => {
        reject(new Error('createProposal socket error'));
      };
    });
  }, name);
}
