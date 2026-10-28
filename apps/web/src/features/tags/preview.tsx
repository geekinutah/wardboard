import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  createTag,
  createWard,
  deleteTag,
  sequentialIds,
  setCallingPreferences,
  setCallingTags,
  setMemberTags,
  tagUsage,
  type Board,
  type MemberId,
  type TagId,
  type Ward,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import type { RequestResult } from '../../sync/protocol.ts';
import { CallingTagsEditor } from './CallingTagsEditor.tsx';
import { MemberTagsEditor } from './MemberTagsEditor.tsx';
import { TagLibrary } from './TagLibrary.tsx';
import './tags.css';

/*
 * Preview scenario for the tags editors: three standalone panels sharing local
 * state, with every edit applied by the core tag functions. Current, the
 * proposal baseline and the proposal board all live in the state so deleting a
 * tag shows its effect on all of them.
 */

interface PreviewState {
  readonly ward: Ward;
  /** [current, baseline, proposal board] */
  readonly boards: readonly [Board, Board, Board];
}

/** The success value of a result with no payload. */
const OK = { ok: true } as RequestResult;

type Refusal = { readonly code: string; readonly message: string };

function refused(error: Refusal): RequestResult<never> {
  return { ok: false, code: error.code, message: error.message };
}

function TagsPreview({ data }: { data: PreviewData }): ReactElement {
  const initial: PreviewState = {
    ward: data.ward,
    boards: [data.current, data.proposal.baseline, data.proposal.board],
  };
  const [state, setState] = useState<PreviewState>(initial);
  const stateRef = useRef<PreviewState>(state);
  const ids = useRef(sequentialIds('preview-tag-'));
  const [highlighted, setHighlighted] = useState<readonly MemberId[]>([]);

  const commit = (next: PreviewState): void => {
    stateRef.current = next;
    setState(next);
  };

  const { ward, boards } = state;
  const proposalBoard = boards[2];
  const member = Object.values(ward.members).sort((a, b) => a.name.localeCompare(b.name, 'en'))[0];
  const listAssignment = Object.values(proposalBoard.assignments).find((a) => a.type === 'list');
  const placed = new Set<string>(Object.values(proposalBoard.placements));
  const dugout = Object.values(ward.members)
    .filter((m) => !placed.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((m) => m.id);

  const onCreateTag = (name: string): Promise<RequestResult<{ tagId: TagId }>> => {
    const result = createTag(stateRef.current.ward, ids.current, name);
    if (!result.ok) {
      return Promise.resolve(refused(result.error));
    }
    commit({ ...stateRef.current, ward: result.value.ward });
    return Promise.resolve({ ok: true, tagId: result.value.tagId });
  };

  const setTags = (memberId: MemberId, tagIds: TagId[]): Promise<RequestResult> => {
    const result = setMemberTags(stateRef.current.ward, memberId, tagIds);
    if (!result.ok) {
      return Promise.resolve(refused(result.error));
    }
    commit({ ...stateRef.current, ward: result.value });
    return Promise.resolve(OK);
  };

  const setNeedsApproval = (memberId: MemberId, value: boolean): Promise<RequestResult> => {
    const current = stateRef.current.ward;
    const person = current.members[memberId];
    if (person === undefined) {
      return Promise.resolve(refused({ code: 'not_found', message: `member ${memberId} does not exist` }));
    }
    const result = createWard({
      tags: current.tags,
      members: { ...current.members, [memberId]: { ...person, needsApproval: value } },
    });
    if (!result.ok) {
      return Promise.resolve(refused({ code: 'invalid', message: JSON.stringify(result.errors) }));
    }
    commit({ ...stateRef.current, ward: result.value });
    return Promise.resolve(OK);
  };

  const editCalling = (
    edit: typeof setCallingTags,
    assignmentId: NonNullable<typeof listAssignment>['id'],
    tagIds: TagId[],
  ): Promise<RequestResult> => {
    const { ward: w, boards: b } = stateRef.current;
    const result = edit(b[2], w, assignmentId, tagIds);
    if (!result.ok) {
      return Promise.resolve(refused(result.error));
    }
    commit({ ward: w, boards: [b[0], b[1], result.board] });
    return Promise.resolve(OK);
  };

  const onDeleteTag = (id: TagId): Promise<RequestResult> => {
    const { ward: w, boards: b } = stateRef.current;
    const result = deleteTag(w, b, id);
    if (!result.ok) {
      return Promise.resolve(refused(result.error));
    }
    const [current, baseline, board] = result.value.boards;
    if (current === undefined || baseline === undefined || board === undefined) {
      return Promise.resolve(refused({ code: 'invalid', message: 'board missing after delete' }));
    }
    commit({ ward: result.value.ward, boards: [current, baseline, board] });
    return Promise.resolve(OK);
  };

  return (
    <div className="wb-tags-preview">
      {member === undefined ? null : (
        <MemberTagsEditor
          member={member}
          ward={ward}
          isAdmin
          onSetTags={(tagIds) => setTags(member.id, tagIds)}
          onCreateTag={onCreateTag}
          onSetNeedsApproval={(value) => setNeedsApproval(member.id, value)}
        />
      )}
      {listAssignment === undefined ? null : (
        <div className="wb-tags-preview-column">
          <CallingTagsEditor
            board={proposalBoard}
            ward={ward}
            assignmentId={listAssignment.id}
            proposalName={data.proposal.name}
            dugoutMemberIds={dugout}
            onSetCallingTags={(tagIds) => editCalling(setCallingTags, listAssignment.id, tagIds)}
            onSetPreferences={(tagIds) => editCalling(setCallingPreferences, listAssignment.id, tagIds)}
            onHighlight={setHighlighted}
          />
          {highlighted.length > 0 ? (
            <p className="wb-tags-note" role="status">
              {`Highlighted in the dugout: ${highlighted.map((id) => ward.members[id]?.name ?? id).join(', ')}`}
            </p>
          ) : null}
        </div>
      )}
      <TagLibrary
        ward={ward}
        usageOf={(id) => tagUsage(ward, boards, id)}
        onCreateTag={onCreateTag}
        onDeleteTag={onDeleteTag}
      />
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Tags and affinities',
  render: (data) => <TagsPreview data={data} />,
};

export default preview;
