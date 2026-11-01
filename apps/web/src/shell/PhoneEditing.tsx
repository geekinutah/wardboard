import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  callingGroupId,
  callingsOf,
  groupDetail,
  memberId as brandMemberId,
  vacancies,
  type AddAssignmentRequest,
  type AssignmentId,
  type Board,
  type BoardId,
  type MemberId,
  type PositionId,
  type Proposal,
  type ReleaseCallingRequest,
  type Ward,
} from '@wardboard/core';
import { ApprovalDialog, SecondCallingDialog, type ApprovalEntry } from '../features/dnd/dialogs.tsx';
import { destinationLabel, memberName, positionLabel } from '../features/dnd/labels.ts';
import { dropContext, preflight, runDropOp, type Preflight } from '../features/dnd/resolve.ts';
import type { DropOp } from '../features/dnd/types.ts';
import { PhoneAddPositionSheet } from '../features/phone-board/PhoneAddPositionSheet.tsx';
import { PhoneBoard } from '../features/phone-board/PhoneBoard.tsx';
import {
  buildFillCandidates,
  buildPersonSheetModel,
  buildVacantDestinations,
  type PhoneVacantDestinationRow,
} from '../features/phone-person/model.ts';
import { PhoneFillSheet } from '../features/phone-person/PhoneFillSheet.tsx';
import { PhoneMoveSheet } from '../features/phone-person/PhoneMoveSheet.tsx';
import { PhonePersonSheet } from '../features/phone-person/PhonePersonSheet.tsx';
import { PhoneProfileSheet } from '../features/phone-person/PhoneProfileSheet.tsx';
import { assignPhoto } from '../features/photos/assignPhoto.ts';
import { photoUrl, uploadPhoto } from '../features/photos/upload.ts';
import type { OpOutcome } from '../sync/client.ts';
import type { Me, ProposalView } from '../sync/protocol.ts';
import { useSync, useSyncClient } from '../sync/react.tsx';
import { committedListPosition } from './EditingLayer.tsx';
import '../features/dnd/dnd.css';
import './phone-editing.css';

type MoveSheet = { readonly kind: 'move'; readonly memberId: string; readonly fromPositionId: string | null };
type FillSheet = { readonly kind: 'fill'; readonly positionId: string };
type AddSheet = {
  readonly kind: 'add';
  readonly groupId: string;
  readonly callingGroupName: string;
  readonly organizationName: string;
};

type Sheet = { readonly kind: 'none' } | { readonly kind: 'person'; readonly memberId: string } | MoveSheet | FillSheet | AddSheet;

/** One server operation the phone sends: a drop operation, a release, or a new position. */
type PhoneOp =
  | DropOp
  | { readonly kind: 'releaseCalling'; readonly request: ReleaseCallingRequest }
  | { readonly kind: 'addAssignment'; readonly request: AddAssignmentRequest };

/** A placement from the move or fill sheet. */
type PlacementOp = Extract<DropOp, { kind: 'placeInPosition' } | { kind: 'addToList' }>;

type Confirmation =
  | { readonly stage: 'second'; readonly op: PlacementOp; readonly pre: Preflight }
  | { readonly stage: 'approval'; readonly op: PlacementOp; readonly entries: readonly ApprovalEntry[] };

type BoardWaiter = {
  readonly boardId: BoardId;
  readonly version: number;
  readonly resolve: (board: Board | null) => void;
};

const NONE: Sheet = { kind: 'none' };

/** The core proposal `preflight` needs, or null on Current or before the baseline loads. */
function coreProposal(view: ProposalView | null, baseline: Board | null, board: Board): Proposal | null {
  if (view === null || baseline === null || board.kind !== 'proposal') return null;
  return {
    id: view.id,
    name: view.name,
    rationale: view.rationale,
    status: view.status,
    // Only Draft proposals are edited here; acceptance details never matter to a placement.
    accepted: null,
    baseline,
    board,
    tabOrder: 0,
    createdAt: '',
    updatedAt: '',
  };
}

function orgLabelOf(board: Board, boardGroupId: string, callingGroupId: string): string {
  const bg = board.boardGroups[boardGroupId as keyof Board['boardGroups']]?.name ?? boardGroupId;
  const cg = board.callingGroups[callingGroupId as keyof Board['callingGroups']]?.name ?? callingGroupId;
  return bg === cg ? bg : `${bg} · ${cg}`;
}

/** The calling a move sheet releases from, labelled as the T-049 move sheet shows it. */
function heldCalling(
  board: Board,
  memberId: string,
  positionId: string,
): { readonly positionId: string; readonly title: string; readonly orgLabel: string } | null {
  const held = callingsOf(board, memberId as MemberId).find((calling) => calling.positionId === positionId);
  if (held === undefined) return null;
  return { positionId: held.positionId, title: held.title, orgLabel: orgLabelOf(board, held.boardGroupId, held.callingGroupId) };
}

/** A vacant position's title and organization, or null once it is filled or gone. */
function vacantPosition(board: Board, positionId: string): { readonly title: string; readonly orgLabel: string } | null {
  const vacancy = vacancies(board).find((item) => item.positionId === positionId);
  if (vacancy === undefined) return null;
  const title = board.assignments[vacancy.assignmentId]?.title ?? vacancy.assignmentId;
  return { title, orgLabel: orgLabelOf(board, vacancy.boardGroupId, vacancy.callingGroupId) };
}

export interface PhoneBoardEditingProps {
  readonly board: Board;
  readonly baseline: Board | null;
  readonly ward: Ward;
  /** The sync proposal view, or null on Current. */
  readonly proposal: ProposalView | null;
  readonly me: Me | null;
  /** 'Current' or the proposal name. */
  readonly boardName: string;
}

/**
 * The phone Board tab with its sheets: tap a person for the person and move
 * sheets, tap a vacancy to fill it from the dugout. Every change is one server
 * operation, confirmed the same way desktop drag and drop confirms it.
 */
export function PhoneBoardEditing({ board, baseline, ward, proposal, me, boardName }: PhoneBoardEditingProps): ReactElement {
  const { send } = useSync();
  const client = useSyncClient();
  const editable = proposal !== null && proposal.status === 'draft' && me !== null && baseline !== null;

  const [sheet, setSheet] = useState<Sheet>(NONE);
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
  const profileOpenRef = useRef(false);
  profileOpenRef.current = profileMemberId !== null;
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const sendingRef = useRef(false);
  const boardRef = useRef(board);
  const waitersRef = useRef<BoardWaiter[]>([]);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    boardRef.current = board;
    const waiting = waitersRef.current;
    if (waiting.length === 0) return;
    waitersRef.current = waiting.filter((waiter) => {
      if (waiter.boardId !== board.id) {
        waiter.resolve(null);
        return false;
      }
      if (board.version >= waiter.version) {
        waiter.resolve(board);
        return false;
      }
      return true;
    });
  }, [board]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const waiting = waitersRef.current;
      waitersRef.current = [];
      for (const waiter of waiting) waiter.resolve(null);
    };
  }, []);

  // A sheet whose subject is gone (or a board that stops being editable) closes.
  const personModel = sheet.kind === 'person' ? buildPersonSheetModel(board, ward, sheet.memberId) : null;
  const sourceCalling =
    sheet.kind === 'move' && sheet.fromPositionId !== null ? heldCalling(board, sheet.memberId, sheet.fromPositionId) : null;
  const fillTarget = sheet.kind === 'fill' ? vacantPosition(board, sheet.positionId) : null;
  const staleSheet =
    (sheet.kind === 'person' && personModel === null) ||
    (sheet.kind === 'move' && (!editable || (sheet.fromPositionId !== null && sourceCalling === null))) ||
    (sheet.kind === 'fill' && (!editable || fillTarget === null)) ||
    (sheet.kind === 'add' && !editable);

  useEffect(() => {
    if (sending) return;
    if (staleSheet) {
      setProfileMemberId(null);
      setSheet(sheet.kind === 'move' && editable ? { kind: 'person', memberId: sheet.memberId } : NONE);
      setConfirm(null);
    } else if (!editable && confirm !== null) {
      setConfirm(null);
    } else if (sheet.kind !== 'person' && profileMemberId !== null) {
      setProfileMemberId(null);
    }
  }, [staleSheet, editable, confirm, sending, sheet, profileMemberId]);

  /** Resolves with the synced board once it reaches `version`, or null if another board opens. */
  function committedBoard(boardId: BoardId, version: number): Promise<Board | null> {
    const shown = boardRef.current;
    if (shown.id !== boardId) return Promise.resolve(null);
    if (shown.version >= version) return Promise.resolve(shown);
    return new Promise((resolve) => {
      waitersRef.current = [...waitersRef.current, { boardId, version, resolve }];
    });
  }

  /** Sends `ops` one at a time. True when every one was applied. */
  async function sendAll(ops: readonly PhoneOp[]): Promise<boolean> {
    const before = boardRef.current;
    const placement = ops[0];
    let placed: Extract<OpOutcome, { ok: true }> | null = null;
    for (const op of ops) {
      let next: PhoneOp = op;
      if (op.kind === 'approvePlacement' && placement?.kind === 'addToList' && placed !== null) {
        // B-031: a full list gets a position the server names. Approve that one.
        const committed = await committedBoard(before.id, placed.version);
        const positionId =
          committed === null
            ? null
            : committedListPosition(before, committed, placement.request.assignmentId, op.request.memberId);
        if (positionId === null) {
          if (mountedRef.current) setFailure("the new position for this approval wasn't found on the saved board");
          return false;
        }
        next = { kind: 'approvePlacement', request: { memberId: op.request.memberId, positionId } };
      }
      const outcome = await send(next.kind, next.request);
      if (!outcome.ok) {
        // The sync banner already says the connection is offline.
        if (outcome.code !== 'offline' && mountedRef.current) setFailure(outcome.message);
        return false;
      }
      if (op === placement) placed = outcome;
    }
    return true;
  }

  /** Sends `ops`; on success shows `done` and (unless `keepOpen`) closes the sheet. */
  function run(ops: readonly PhoneOp[], done: string, keepOpen = false): void {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    setStatus(null);
    void sendAll(ops)
      .then((ok) => {
        if (!ok || !mountedRef.current) return;
        setStatus(done);
        if (!keepOpen) setSheet(NONE);
      })
      .finally(() => {
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      });
  }

  function placementDone(op: PlacementOp): string {
    const name = memberName(ward, op.request.memberId);
    return op.request.from === null ? `Placed ${name}` : `Moved ${name}`;
  }

  function commitPlacement(op: PlacementOp, entries: readonly ApprovalEntry[]): void {
    setConfirm(null);
    const approvals: DropOp[] = entries.map((entry) => ({
      kind: 'approvePlacement',
      request: { memberId: entry.memberId, positionId: entry.positionId },
    }));
    run([op, ...approvals], placementDone(op));
  }

  function approvalEntries(op: PlacementOp, pre: Preflight): ApprovalEntry[] {
    const after = runDropOp(board, dropContext(board, ward), op);
    const labelsFrom = after.ok ? after.board : board;
    return pre.approvals.map((approval) => ({
      memberId: approval.memberId,
      positionId: approval.positionId,
      name: memberName(ward, approval.memberId),
      calling: positionLabel(labelsFrom, approval.positionId),
    }));
  }

  function afterSecondCalling(op: PlacementOp, pre: Preflight): void {
    if (pre.approvals.length > 0) {
      setConfirm({ stage: 'approval', op, entries: approvalEntries(op, pre) });
      return;
    }
    commitPlacement(op, []);
  }

  /** Checks a placement with core, then asks the same confirmations desktop asks. */
  function place(op: PlacementOp): void {
    if (sendingRef.current || !editable) return;
    setFailure(null);
    const trial = runDropOp(board, dropContext(board, ward), op);
    if (!trial.ok) {
      setFailure(trial.error.message);
      return;
    }
    const pre = preflight(coreProposal(proposal, baseline, board), board, ward, op);
    if (pre.secondCalling !== null) {
      setConfirm({ stage: 'second', op, pre });
      return;
    }
    afterSecondCalling(op, pre);
  }

  const closeSheet = useCallback(() => {
    if (sendingRef.current) return;
    // Escape reaches the person sheet underneath the profile. Close only the profile.
    if (profileOpenRef.current) {
      setProfileMemberId(null);
      return;
    }
    setSheet(NONE);
  }, []);

  const closeProfile = useCallback(() => {
    if (sendingRef.current) return;
    setProfileMemberId(null);
  }, []);

  const cancelConfirm = useCallback(() => {
    if (sendingRef.current) return;
    setConfirm(null);
  }, []);

  function openSheet(next: Sheet): void {
    if (sendingRef.current) return;
    setQuery('');
    setFailure(null);
    setProfileMemberId(null);
    setSheet(next);
  }

  /** Opens add-position only when the calling group and its board group both exist. */
  function openAddPosition(id: string): void {
    if (baseline === null) return;
    const groupKey = callingGroupId(id);
    if (!Object.hasOwn(board.callingGroups, groupKey)) return;
    const group = board.callingGroups[groupKey];
    if (group === undefined) return;
    const detail = groupDetail(board, ward, group.id, baseline);
    const organization = board.boardGroups[detail.boardGroupId];
    if (organization === undefined) return;
    openSheet({
      kind: 'add',
      groupId: group.id,
      callingGroupName: group.name,
      organizationName: organization.name,
    });
  }

  async function saveNote(note: string | null): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
    if (profileMemberId === null) return { ok: false, message: 'That member is not on this ward.' };
    if (sendingRef.current) return { ok: false, message: 'Please wait.' };
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await client.updateMember(profileMemberId, { note });
      if (result.ok) return { ok: true };
      return { ok: false, message: result.message };
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  }

  async function assignPortrait(id: string, ref: string): Promise<void> {
    const result = await assignPhoto(client, id, ref);
    if (!result.ok) throw new Error(result.message);
  }

  let overlay: ReactNode = null;
  if (confirm !== null && editable) {
    if (confirm.stage === 'second') {
      const notice = confirm.pre.secondCalling;
      const destination = destinationLabel(board, confirm.op);
      if (notice !== null && destination !== null) {
        const { op, pre } = confirm;
        overlay = (
          <SecondCallingDialog
            key="second"
            name={memberName(ward, notice.memberId)}
            notice={notice}
            destination={destination}
            onCancel={cancelConfirm}
            onConfirm={() => {
              afterSecondCalling(op, pre);
            }}
          />
        );
      }
    } else {
      const { op, entries } = confirm;
      overlay = (
        <ApprovalDialog
          key="approval"
          approvals={entries}
          proposalName={proposal.name}
          recordedAs={me.displayName}
          onCancel={cancelConfirm}
          onConfirm={() => {
            commitPlacement(op, entries);
          }}
        />
      );
    }
  } else if (sheet.kind === 'person' && personModel !== null) {
    const memberId = sheet.memberId;
    overlay = (
      <PhonePersonSheet
        model={personModel}
        boardName={boardName}
        editable={editable}
        onStartMove={(positionId) => {
          openSheet({ kind: 'move', memberId, fromPositionId: positionId });
        }}
        onRelease={(positionId) => {
          run(
            [{ kind: 'releaseCalling', request: { memberId: memberId as MemberId, positionId: positionId as PositionId } }],
            `Released ${personModel.name}`,
          );
        }}
        onAddToDugout={() => {
          run([{ kind: 'addToDugout', request: { memberId: memberId as MemberId } }], `Added ${personModel.name} to dugout`, true);
        }}
        {...(editable
          ? {
              onPlaceFromDugout: () => {
                openSheet({ kind: 'move', memberId, fromPositionId: null });
              },
            }
          : {})}
        {...(me !== null
          ? {
              onOpenProfile: () => {
                if (sendingRef.current) return;
                setProfileMemberId(memberId);
              },
            }
          : {})}
        onClose={closeSheet}
      />
    );
  } else if (sheet.kind === 'move' && editable && !staleSheet) {
    const { memberId, fromPositionId } = sheet;
    const name = memberName(ward, memberId as MemberId);
    overlay = (
      <PhoneMoveSheet
        memberName={name}
        sourceCalling={sourceCalling}
        destinations={buildVacantDestinations(board, ward, memberId, query)}
        query={query}
        onQueryChange={setQuery}
        onSelectDestination={(target: PhoneVacantDestinationRow['target']) => {
          const from = fromPositionId as PositionId | null;
          if (target.kind === 'single') {
            place({
              kind: 'placeInPosition',
              request: { memberId: memberId as MemberId, from, to: target.positionId as PositionId },
            });
          } else {
            place({
              kind: 'addToList',
              request: { memberId: memberId as MemberId, from, assignmentId: target.assignmentId as AssignmentId },
            });
          }
        }}
        onSendToDugout={
          fromPositionId === null
            ? null
            : () => {
                run(
                  [{ kind: 'moveToDugout', request: { memberId: memberId as MemberId, from: fromPositionId as PositionId } }],
                  `Sent ${name} to dugout`,
                );
              }
        }
        onCancel={closeSheet}
      />
    );
  } else if (sheet.kind === 'fill' && editable && fillTarget !== null) {
    const positionId = sheet.positionId as PositionId;
    overlay = (
      <PhoneFillSheet
        title={fillTarget.title}
        orgLabel={fillTarget.orgLabel}
        candidates={buildFillCandidates(board, ward, positionId, query)}
        query={query}
        onQueryChange={setQuery}
        onSelect={(chosen) => {
          const position = board.positions[positionId];
          const assignment = position === undefined ? undefined : board.assignments[position.assignmentId];
          if (assignment === undefined) return;
          const memberId = chosen as MemberId;
          if (assignment.type === 'list') {
            place({ kind: 'addToList', request: { memberId, from: null, assignmentId: assignment.id } });
          } else {
            place({ kind: 'placeInPosition', request: { memberId, from: null, to: positionId } });
          }
        }}
        onCancel={closeSheet}
      />
    );
  } else if (sheet.kind === 'add' && editable) {
    const { groupId, callingGroupName, organizationName } = sheet;
    overlay = (
      <PhoneAddPositionSheet
        callingGroupName={callingGroupName}
        organizationName={organizationName}
        groupId={groupId}
        onSubmit={(request) => {
          run([{ kind: 'addAssignment', request }], `Added ${request.title}`);
        }}
        onClose={closeSheet}
      />
    );
  }

  const profileMember = profileMemberId === null ? undefined : ward.members[brandMemberId(profileMemberId)];
  const profileNode =
    sheet.kind === 'person' && me !== null && profileMember !== undefined ? (
      <PhoneProfileSheet
        member={{
          id: profileMember.id,
          name: profileMember.name,
          photoRef: profileMember.photoRef,
          note: profileMember.note,
          category: profileMember.category,
        }}
        currentUrl={profileMember.photoRef === null ? null : photoUrl(profileMember.photoRef)}
        onSaveNote={(note) => saveNote(note)}
        upload={uploadPhoto}
        assign={(id, ref) => assignPortrait(id, ref)}
        onClose={closeProfile}
      />
    ) : null;

  return (
    <div className="wb-phone-editing">
      {status === null ? null : (
        <p className="wb-phone-editing-status" role="status">
          {status}
        </p>
      )}
      {failure === null ? null : (
        <div className="wb-phone-editing-alert" role="alert">
          <p className="wb-phone-editing-alert-text">{`Couldn't apply the change: ${failure}`}</p>
          <button
            type="button"
            className="wb-phone-editing-dismiss"
            onClick={() => {
              setFailure(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <PhoneBoard
        board={board}
        baseline={baseline}
        ward={ward}
        editable={editable}
        onOpenPerson={(memberId) => {
          openSheet({ kind: 'person', memberId });
        }}
        onOpenVacancy={(positionId) => {
          if (editable) openSheet({ kind: 'fill', positionId });
        }}
        {...(editable ? { onAddPosition: (id: string) => { openAddPosition(id); } } : {})}
      />
      {overlay === null && profileNode === null ? null : (
        <fieldset className="wb-phone-editing-sheet" disabled={sending} aria-busy={sending}>
          {overlay}
          {profileNode}
        </fieldset>
      )}
    </div>
  );
}
