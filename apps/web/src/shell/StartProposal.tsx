import { useCallback, type ReactElement } from 'react';
import { Button } from '../design/Button.tsx';
import { CurrentReadOnlyBar } from '../features/proposals/CurrentReadOnlyBar.tsx';
import {
  StartProposalDialog,
  type CreateProposalRequest,
  type CreateProposalResult,
  type StartProposalChoice,
  type StartProposalSource,
} from '../features/proposals/StartProposalDialog.tsx';
import { type SyncClient, type SyncState } from '../sync/client.ts';
import { useSync, useSyncClient } from '../sync/react.tsx';

export type StartProposalProps = {
  readonly isOpen: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
};

export function StartProposalTabButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Button type="button" variant="primary" onClick={onClick} style={{ minWidth: 44, minHeight: 44, flex: 'none' }}>
      + Start proposal
    </Button>
  );
}

function listed(boards: SyncState['boards'], boardId: string): boolean {
  return boards?.proposals.some((item) => item.boardId === boardId) ?? false;
}

/** Resolves once `boards` lists `boardId`, including a list that arrived before this wait. */
function waitForBoard(client: SyncClient, boardId: string): Promise<void> {
  if (listed(client.getState().boards, boardId)) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = client.subscribe((state) => {
      if (!listed(state.boards, boardId)) return;
      stop();
      resolve();
    });
    if (listed(client.getState().boards, boardId)) {
      stop();
      resolve();
    }
  });
}

export function StartProposal({ isOpen, onOpen, onClose }: StartProposalProps): ReactElement | null {
  const client = useSyncClient();
  const { boards, subscribedBoardId, open } = useSync();
  const current = boards?.current ?? null;
  const onCurrent = current !== null && subscribedBoardId === current.boardId;
  const importedAt = current?.importedAt ?? '';
  const proposals: readonly StartProposalChoice[] =
    boards?.proposals.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      tabOrder: item.tabOrder,
    })) ?? [];
  const activeProposal = boards?.proposals.find((item) => item.boardId === subscribedBoardId);
  const initialSource: StartProposalSource =
    activeProposal === undefined ? { kind: 'current' } : { kind: 'proposal', proposalId: activeProposal.id };

  const onCreate = useCallback(
    async (request: CreateProposalRequest): Promise<CreateProposalResult> => {
      const result = await client.createProposal(request);
      if (!result.ok) return { ok: false, message: result.message };
      // StartProposalDialog calls onClose as soon as this resolves ok. Wait until
      // the new board is listed — proposalCreated can arrive before that push —
      // and subscribe before resolving, so this client switches only then.
      await waitForBoard(client, result.boardId);
      open(result.boardId);
      return { ok: true };
    },
    [client, open],
  );

  if (!onCurrent && !isOpen) return null;

  return (
    <>
      {onCurrent ? <CurrentReadOnlyBar importedAt={importedAt} onStartProposal={onOpen} /> : null}
      {isOpen ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
          <StartProposalDialog
            importedAt={importedAt}
            proposals={proposals}
            initialSource={initialSource}
            onCreate={onCreate}
            onClose={onClose}
          />
        </div>
      ) : null}
    </>
  );
}
