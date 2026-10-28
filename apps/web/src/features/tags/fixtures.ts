import {
  createTag,
  sequentialIds,
  setCallingPreferences,
  setCallingTags,
  setMemberTags,
  type AssignmentId,
  type Board,
  type MemberId,
  type Proposal,
  type TagId,
  type Ward,
} from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { buildBoard, buildProposal, buildWard, type OrgSpec } from '../summary/fixtures.ts';

/*
 * Fictional scenario for the tags feature tests: a four-member ward with four
 * tags, a Current board, and a proposal whose list calling prefers tags.
 */

export interface TagsScenario {
  readonly ward: Ward;
  readonly current: Board;
  readonly proposal: Proposal;
  readonly tags: { readonly weekday: TagId; readonly pianist: TagId; readonly outdoors: TagId; readonly evenings: TagId };
  readonly members: { readonly ann: MemberId; readonly bob: MemberId; readonly cid: MemberId; readonly dee: MemberId };
  readonly listAssignment: AssignmentId;
  readonly singleAssignment: AssignmentId;
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function mustBoard(result: { ok: true; board: Board } | { ok: false; error: { message: string } }): Board {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.board;
}

const SPEC: OrgSpec[] = [
  {
    name: 'Aaronic Priesthood',
    groups: [
      {
        name: 'Deacons Quorum',
        assignments: [
          { title: 'Deacons Quorum Adviser', type: 'list', occupants: ['Ann Alpha', null, null] },
          { title: 'Deacons Quorum President', type: 'single', occupants: ['Bob Beta'] },
        ],
      },
    ],
  },
];

export function tagsScenario(): TagsScenario {
  const ids = sequentialIds('t');
  let ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid Gamma', 'Dee Delta']);
  const created: Record<string, TagId> = {};
  for (const name of ['Weekday', 'Pianist', 'Outdoors', 'Evenings only']) {
    const result = must(createTag(ward, ids, name));
    ward = result.ward;
    created[name] = result.tagId;
  }
  const weekday = created['Weekday'] as TagId;
  const pianist = created['Pianist'] as TagId;
  const outdoors = created['Outdoors'] as TagId;
  const evenings = created['Evenings only'] as TagId;
  const byName = (name: string): MemberId => {
    const found = Object.values(ward.members).find((m) => m.name === name);
    if (found === undefined) {
      throw new Error(`no member ${name}`);
    }
    return found.id;
  };
  const ann = byName('Ann Alpha');
  const bob = byName('Bob Beta');
  const cid = byName('Cid Gamma');
  const dee = byName('Dee Delta');
  ward = must(setMemberTags(ward, ann, [weekday, pianist]));
  ward = must(setMemberTags(ward, cid, [weekday]));
  ward = must(setMemberTags(ward, dee, [evenings]));

  const current = buildBoard(SPEC, { kind: 'current', id: 'b-current' }, ward);
  const baseline = buildBoard(SPEC, { kind: 'baseline', id: 'b-baseline' }, ward);
  let board = buildBoard(SPEC, { kind: 'proposal', id: 'b-board' }, ward);
  const assignments = Object.values(board.assignments);
  const list = assignments.find((a) => a.type === 'list');
  const single = assignments.find((a) => a.type === 'single');
  if (list === undefined || single === undefined) {
    throw new Error('fixture needs a list and a single assignment');
  }
  board = mustBoard(setCallingTags(board, ward, list.id, [outdoors]));
  board = mustBoard(setCallingPreferences(board, ward, list.id, [weekday, pianist]));
  const proposal = buildProposal(baseline, board, ward, { name: 'Spring adjustments' });
  return {
    ward,
    current,
    proposal,
    tags: { weekday, pianist, outdoors, evenings },
    members: { ann, bob, cid, dee },
    listAssignment: list.id,
    singleAssignment: single.id,
  };
}

/** A resolved success, typed as the callbacks' result. */
export function okResult(): Promise<RequestResult> {
  return Promise.resolve({ ok: true } as RequestResult);
}

/** A resolved refusal, typed as the callbacks' result. */
export function refusal<T extends object = Record<string, never>>(code: string, message: string): Promise<RequestResult<T>> {
  return Promise.resolve({ ok: false, code, message });
}
