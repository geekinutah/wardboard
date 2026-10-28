import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  addToList,
  addToDugout,
  callingsOf,
  dugout,
  moveToDugout,
  placeInPosition,
  proposalDiff,
  releaseCalling,
  removedState,
  sequentialIds,
  vacancies,
  type AssignmentId,
  type Board,
  type MemberId,
  type OperationContext,
  type PositionId,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { PhoneBoard } from '../phone-board/PhoneBoard.tsx';
import { PhoneShell, type PhoneTab } from '../phone-shell/PhoneShell.tsx';
import { changeCount, headerSummary, type BoardEntry } from '../phone-shell/summary.ts';
import { buildPersonSheetModel, buildVacantDestinations } from './model.ts';
import { PhoneMoveSheet } from './PhoneMoveSheet.tsx';
import { PhonePersonSheet } from './PhonePersonSheet.tsx';

type SheetState =
  | { readonly kind: 'none' }
  | { readonly kind: 'person'; readonly memberId: string }
  | { readonly kind: 'move'; readonly memberId: string; readonly fromPositionId: string | null };

function PhonePersonPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [board, setBoard] = useState<Board>(() => data.proposal.board);
  const [activeBoardId, setActiveBoardId] = useState<string>(data.proposal.id);
  const [activeTab, setActiveTab] = useState<PhoneTab>('board');
  const [query, setQuery] = useState<string>('');
  const [status, setStatus] = useState<string | null>(null);

  const idsRef = useRef(sequentialIds('phone-person'));
  const ctx: OperationContext = useMemo(
    () => ({ ward: data.ward, ids: idsRef.current }),
    [data.ward],
  );

  const joTestwellId = useMemo(() => {
    const jo = Object.values(data.ward.members).find((m) => m.name === 'Jo Testwell');
    return jo?.id ?? '';
  }, [data.ward.members]);

  const primaryBoardGroupId = useMemo(() => {
    const found = Object.values(data.proposal.board.boardGroups).find(
      (bg) => bg.key === 'primary' || bg.name === 'Primary',
    );
    return found?.id ?? '';
  }, [data.proposal.board.boardGroups]);

  const [sheet, setSheet] = useState<SheetState>(() => ({
    kind: 'person',
    memberId: joTestwellId,
  }));

  const fixtureRemoved = removedState(data.proposal, data.current, data.ward);
  const fixtureRemovedCount = fixtureRemoved.members.length + fixtureRemoved.positions.length;
  const fixtureDiff = proposalDiff(data.proposal);
  const fixtureChangeCount = changeCount(fixtureDiff);

  const boards: readonly BoardEntry[] = [
    {
      id: data.current.id,
      kind: 'current',
      name: 'Current',
      status: 'current',
      importedAt: '2026-10-24T12:00:00Z',
      changeCount: 0,
      removedCount: 0,
    },
    {
      id: data.proposal.id,
      kind: 'proposal',
      name: data.proposal.name,
      status: data.proposal.status,
      importedAt: null,
      changeCount: fixtureChangeCount,
      removedCount: fixtureRemovedCount,
    },
    {
      id: 'prop-youth',
      kind: 'proposal',
      name: 'Youth focus',
      status: 'accepted',
      importedAt: null,
      changeCount: 0,
      removedCount: 0,
    },
  ];

  const editable = activeBoardId === data.proposal.id;
  const currentBoard = editable ? board : data.current;
  const baseline = editable ? data.proposal.baseline : null;

  const currentDiff = proposalDiff({ ...data.proposal, board: currentBoard });
  let summary: string;
  let dugoutCount: number;
  if (activeBoardId === data.current.id) {
    summary = headerSummary({
      kind: 'current',
      callings: 0,
      releases: 0,
      vacant: vacancies(data.current).length,
    });
    dugoutCount = dugout(data.current, data.ward).length;
  } else {
    summary = headerSummary({
      kind: 'proposal',
      callings: currentDiff.callings.length,
      releases: currentDiff.releases.length,
      vacant: vacancies(currentBoard).length,
    });
    dugoutCount = dugout(currentBoard, data.ward).length;
  }

  const tabTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);

  const activeMember =
    sheet.kind !== 'none' ? data.ward.members[sheet.memberId as MemberId] : undefined;
  const activeMemberName = activeMember?.name ?? '';

  const personModel =
    sheet.kind === 'person' ? buildPersonSheetModel(currentBoard, data.ward, sheet.memberId) : null;

  const moveDestinations =
    sheet.kind === 'move'
      ? buildVacantDestinations(currentBoard, data.ward, sheet.memberId, query)
      : [];

  const sourceCalling = useMemo(() => {
    if (sheet.kind !== 'move' || sheet.fromPositionId === null) {
      return null;
    }
    const held = callingsOf(currentBoard, sheet.memberId as MemberId).find(
      (h) => h.positionId === sheet.fromPositionId,
    );
    if (held === undefined) {
      return null;
    }
    const bg = currentBoard.boardGroups[held.boardGroupId]?.name ?? held.boardGroupId;
    const cg = currentBoard.callingGroups[held.callingGroupId]?.name ?? held.callingGroupId;
    const orgLabel = bg === cg ? bg : `${bg} \u00B7 ${cg}`;
    return {
      positionId: held.positionId,
      title: held.title,
      orgLabel,
    };
  }, [currentBoard, sheet]);

  return (
    <PhoneShell
      boards={boards}
      activeBoardId={activeBoardId}
      summary={summary}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dugoutCount={dugoutCount}
      onSelectBoard={(id) => {
        setActiveBoardId(id);
        setStatus(null);
        setSheet({ kind: 'none' });
      }}
      onStartProposal={() => undefined}
      canStartProposal
    >
      {activeTab === 'board' ? (
        <>
          {status !== null ? (
            <p className="wb-phone-board-status" role="status">
              {status}
            </p>
          ) : null}
          <PhoneBoard
            board={currentBoard}
            baseline={baseline}
            ward={data.ward}
            editable={editable}
            initialScreen={{ kind: 'organization', boardGroupId: primaryBoardGroupId }}
            onAddPosition={() => {
              setStatus('Add position tapped');
            }}
            onOpenPerson={(memberId) => {
              setSheet({ kind: 'person', memberId });
            }}
            onOpenVacancy={() => {
              setStatus('Vacancy tapped');
            }}
          />
        </>
      ) : (
        <p className="wb-phone-board-placeholder">{tabTitle} tab content</p>
      )}

      {sheet.kind === 'person' && personModel !== null ? (
        <PhonePersonSheet
          model={personModel}
          boardName={data.proposal.name}
          editable={editable}
          onStartMove={(positionId) => {
            setQuery('');
            setSheet({ kind: 'move', memberId: sheet.memberId, fromPositionId: positionId });
          }}
          onRelease={(positionId) => {
            const result = releaseCalling(currentBoard, ctx, {
              memberId: sheet.memberId as MemberId,
              positionId: positionId as PositionId,
            });
            if (result.ok) {
              setBoard(result.board);
              setStatus(`Released ${activeMemberName}`);
              setSheet({ kind: 'none' });
            }
          }}
          onAddToDugout={() => {
            const result = addToDugout(currentBoard, ctx, {
              memberId: sheet.memberId as MemberId,
            });
            if (result.ok) {
              setBoard(result.board);
              setStatus(`Added ${activeMemberName} to dugout`);
            }
          }}
          onPlaceFromDugout={() => {
            setQuery('');
            setSheet({ kind: 'move', memberId: sheet.memberId, fromPositionId: null });
          }}
          onOpenProfile={() => {
            setStatus(`Profile requested for ${activeMemberName}`);
            setSheet({ kind: 'none' });
          }}
          onClose={() => {
            setSheet({ kind: 'none' });
          }}
        />
      ) : null}

      {sheet.kind === 'move' ? (
        <PhoneMoveSheet
          memberName={activeMemberName}
          sourceCalling={sourceCalling}
          destinations={moveDestinations}
          query={query}
          onQueryChange={setQuery}
          onSelectDestination={(target) => {
            if (target.kind === 'single') {
              const result = placeInPosition(currentBoard, ctx, {
                memberId: sheet.memberId as MemberId,
                from: sheet.fromPositionId as PositionId | null,
                to: target.positionId as PositionId,
              });
              if (result.ok) {
                setBoard(result.board);
                setSheet({ kind: 'none' });
                setStatus(`Moved ${activeMemberName}`);
              }
            } else {
              const result = addToList(currentBoard, ctx, {
                memberId: sheet.memberId as MemberId,
                from: sheet.fromPositionId as PositionId | null,
                assignmentId: target.assignmentId as AssignmentId,
              });
              if (result.ok) {
                setBoard(result.board);
                setSheet({ kind: 'none' });
                setStatus(`Moved ${activeMemberName}`);
              }
            }
          }}
          onSendToDugout={
            sheet.fromPositionId !== null
              ? () => {
                  const result = moveToDugout(currentBoard, ctx, {
                    memberId: sheet.memberId as MemberId,
                    from: sheet.fromPositionId as PositionId,
                  });
                  if (result.ok) {
                    setBoard(result.board);
                    setSheet({ kind: 'none' });
                    setStatus(`Sent ${activeMemberName} to dugout`);
                  }
                }
              : null
          }
          onCancel={() => {
            setSheet({ kind: 'none' });
          }}
        />
      ) : null}
    </PhoneShell>
  );
}

const preview: PreviewModule = {
  title: 'Phone person & move',
  render: (data) => <PhonePersonPreview data={data} />,
};

export default preview;
