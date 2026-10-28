import { useCallback, useId, useState, type ReactElement } from 'react';
import { dugout, memberId as toMemberId, tagId as toTagId } from '@wardboard/core';
import type { AssignmentId, Board, CallingGroupId, MemberId, TagId, Ward } from '@wardboard/core';
import { CallingTagsEditor } from '../features/tags/CallingTagsEditor.tsx';
import { MemberTagsEditor } from '../features/tags/MemberTagsEditor.tsx';
import type { OpOutcome } from '../sync/client.ts';
import type { RequestResult } from '../sync/protocol.ts';
import { useMe, useSync, useSyncClient } from '../sync/react.tsx';
import './tags-wiring.css';

/*
 * T-088: wires T-039's tag editors to the server. Member tags are ward-wide, so
 * the member section is editable on every board; calling tags belong to a Draft
 * proposal (SPEC §6, §7).
 */

/** Member tags and the Admin-only Needs approval switch for the selected person. */
export function MemberTagsSection({
  ward,
  memberId,
}: {
  ward: Ward;
  memberId: string;
}): ReactElement | null {
  const client = useSyncClient();
  const me = useMe();
  const member = ward.members[toMemberId(memberId)];
  if (member === undefined) return null;
  return (
    <div className="shell-tags-member">
      <MemberTagsEditor
        member={member}
        ward={ward}
        isAdmin={me?.role === 'admin'}
        showName={false}
        onSetTags={(tagIds) => client.updateMember(memberId, { tagIds })}
        onCreateTag={async (name): Promise<RequestResult<{ tagId: TagId }>> => {
          const created = await client.createTag(name);
          return created.ok ? { ok: true, tagId: toTagId(created.tagId) } : created;
        }}
        onSetNeedsApproval={(value) => client.setNeedsApproval(memberId, value)}
      />
    </div>
  );
}

function toResult(outcome: OpOutcome): RequestResult {
  // `RequestResult`'s empty payload is `Record<string, never>`, which a bare literal cannot satisfy.
  if (outcome.ok) return { ok: true } as RequestResult;
  return { ok: false, code: outcome.code, message: outcome.message };
}

/** Calling tags and preferences for one of the group's callings, with the affinity match line. */
export function CallingTagsPanel({
  board,
  ward,
  callingGroupId,
}: {
  board: Board;
  ward: Ward;
  callingGroupId: CallingGroupId;
}): ReactElement | null {
  const { send, proposal } = useSync();
  const headingId = useId();
  const selectId = useId();
  const [chosen, setChosen] = useState<AssignmentId | null>(null);
  const [highlight, setHighlight] = useState<{ assignmentId: AssignmentId; ids: readonly MemberId[] } | null>(null);

  const assignments = Object.values(board.assignments)
    .filter((a) => a.groupId === callingGroupId && a.enabled)
    .sort((a, b) => a.order - b.order);
  const selected = assignments.find((a) => a.id === chosen) ?? assignments[0];
  const assignmentId = selected?.id;

  const onSetCallingTags = useCallback(
    async (tagIds: TagId[]): Promise<RequestResult> =>
      toResult(await send('setCallingTags', { assignmentId, tagIds })),
    [send, assignmentId],
  );
  const onSetPreferences = useCallback(
    async (tagIds: TagId[]): Promise<RequestResult> =>
      toResult(await send('setCallingPreferences', { assignmentId, tagIds })),
    [send, assignmentId],
  );

  if (selected === undefined) return null;

  const draftName = board.kind === 'proposal' && proposal?.status === 'draft' ? proposal.name : null;
  const matching = highlight !== null && highlight.assignmentId === selected.id ? highlight.ids : [];
  const names = matching.map((id) => ward.members[id]?.name ?? id);

  return (
    <section
      className="shell-calling-tags"
      aria-labelledby={headingId}
      // The canvas takes focus on a press outside a control. That would blur the
      // tag picker and close it before its option is chosen, so presses stay here.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="shell-calling-tags-head">
        <h2 id={headingId} className="shell-calling-tags-title">
          Calling tags
        </h2>
        <div className="shell-calling-tags-pick">
          <label htmlFor={selectId} className="shell-calling-tags-label">
            Calling
          </label>
          <select
            id={selectId}
            className="shell-calling-tags-select"
            value={selected.id}
            onChange={(event) => {
              setChosen(event.target.value as AssignmentId);
              setHighlight(null);
            }}
          >
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <CallingTagsEditor
        key={selected.id}
        board={board}
        ward={ward}
        assignmentId={selected.id}
        proposalName={draftName}
        dugoutMemberIds={dugout(board, ward).map((entry) => entry.memberId)}
        onSetCallingTags={onSetCallingTags}
        onSetPreferences={onSetPreferences}
        onHighlight={(ids) => {
          setHighlight({ assignmentId: selected.id, ids });
        }}
      />
      {names.length > 0 ? (
        <p role="status" className="shell-calling-tags-matching">{`Matching: ${names.join(', ')}`}</p>
      ) : null}
    </section>
  );
}
