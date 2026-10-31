import {
  addAssignment,
  addCallingGroup,
  addListPosition,
  addToDugout,
  addToList,
  approvePlacement,
  assignmentId,
  boardGroupId,
  callingGroupId,
  CALLING_GENDER_RULES,
  clearOversight as applyClearOversight,
  memberId,
  moveGroup,
  moveToDugout,
  placeInPosition,
  positionId,
  releaseCalling,
  releaseOccupant,
  removeAssignment,
  removePosition,
  renameGroup,
  setBoardGroupVisible,
  OVERSEERS,
  setCallingPreferences,
  setCallingTags,
  setOversight as applySetOversight,
  swap,
  tagId,
  userId,
  type AssignmentId,
  type AssignmentType,
  type Board,
  type CallingGenderRule,
  type CallingGroupParent,
  type IdGenerator,
  type MemberId,
  type OperationContext,
  type Overseer,
  type PositionId,
  type TagId,
  type Ward,
} from '@wardboard/core';

/** Client operation kinds. Ward edits are intentionally absent. */
export type OpKind = keyof typeof operationRegistry;

export type OperationDeps = {
  ward: Ward;
  ids: IdGenerator;
  actorId: string;
  approvedAt: string;
  baseline: Board | null;
};

type Outcome =
  | { ok: true; board: Board }
  | { ok: false; code: string; message: string };

type CoreResult = { ok: true; board: Board } | { ok: false; error: { code: string; message: string } };

export type Prepared =
  | { ok: false; code: 'bad_request' | 'unknown_operation'; message: string }
  | { ok: true; apply: (board: Board, deps: OperationDeps) => Outcome };

type RegistryEntry = {
  prepare: (request: unknown) => Prepared;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).length !== keys.length) return undefined;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return undefined;
  }
  return value;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return text(value);
}

function integer(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function texts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    const id = text(item);
    if (id === undefined) return undefined;
    items.push(id);
  }
  return items;
}

function parent(value: unknown): CallingGroupParent | undefined {
  const body = record(value, ['kind', 'id']);
  if (body === undefined) return undefined;
  const id = text(body.id);
  if (id === undefined) return undefined;
  if (body.kind === 'boardGroup') return { kind: 'boardGroup', id: boardGroupId(id) };
  if (body.kind === 'callingGroup') return { kind: 'callingGroup', id: callingGroupId(id) };
  return undefined;
}

function assignmentTypeOf(value: unknown): AssignmentType | undefined {
  if (value === 'single' || value === 'list') return value;
  return undefined;
}

function overseerValue(value: unknown): Overseer | undefined {
  if (typeof value !== 'string') return undefined;
  for (const overseer of OVERSEERS) {
    if (value === overseer) return overseer;
  }
  return undefined;
}

function refuse(message: string): Prepared {
  return { ok: false, code: 'bad_request', message };
}

function accept(apply: (board: Board, deps: OperationDeps) => Outcome): Prepared {
  return { ok: true, apply };
}

function fromOutcome(result: CoreResult): Outcome {
  if (result.ok) return { ok: true, board: result.board };
  return { ok: false, code: result.error.code, message: result.error.message };
}

function coreOp<Request>(
  run: (board: Board, ctx: OperationContext, request: Request) => CoreResult,
  request: Request,
): Prepared {
  return accept((board, deps) => fromOutcome(run(board, { ward: deps.ward, ids: deps.ids }, request)));
}

type Unwrapped = { matched: true; body: Record<string, unknown> } | { matched: false; prepared: Prepared };

function unwrap(request: unknown, keys: readonly string[]): Unwrapped {
  const body = record(request, keys);
  if (body === undefined) {
    return { matched: false, prepared: refuse(`request must contain exactly ${keys.join(', ')}`) };
  }
  return { matched: true, body };
}

function memberOf(value: unknown): MemberId | undefined {
  const id = text(value);
  return id === undefined ? undefined : memberId(id);
}

function positionOf(value: unknown): PositionId | undefined {
  const id = text(value);
  return id === undefined ? undefined : positionId(id);
}

function nullablePosition(value: unknown): PositionId | null | undefined {
  const id = nullableText(value);
  if (id === undefined) return undefined;
  return id === null ? null : positionId(id);
}

function assignmentOf(value: unknown): AssignmentId | undefined {
  const id = text(value);
  return id === undefined ? undefined : assignmentId(id);
}

function entry(prepare: (request: unknown) => Prepared): RegistryEntry {
  return { prepare };
}

function nullableMove(
  run: (
    board: Board,
    ctx: OperationContext,
    request: { memberId: MemberId; from: PositionId | null; to: PositionId },
  ) => CoreResult,
): RegistryEntry {
  return entry((request) => {
    const parsed = unwrap(request, ['memberId', 'from', 'to']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const from = nullablePosition(parsed.body.from);
    const to = positionOf(parsed.body.to);
    if (member === undefined || from === undefined || to === undefined) {
      return refuse('memberId and to must be non-empty strings, and from must be a string or null');
    }
    return coreOp(run, { memberId: member, from, to });
  });
}

export const operationRegistry = {
  placeInPosition: nullableMove(placeInPosition),
  addToList: entry((request) => {
    const parsed = unwrap(request, ['memberId', 'from', 'assignmentId']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const from = nullablePosition(parsed.body.from);
    const assignment = assignmentOf(parsed.body.assignmentId);
    if (member === undefined || from === undefined || assignment === undefined) {
      return refuse('addToList requires memberId, from, and assignmentId');
    }
    return coreOp(addToList, { memberId: member, from, assignmentId: assignment });
  }),
  swap: entry((request) => {
    const parsed = unwrap(request, ['memberId', 'from', 'to']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const from = positionOf(parsed.body.from);
    const to = positionOf(parsed.body.to);
    if (member === undefined || from === undefined || to === undefined) {
      return refuse('swap requires memberId, from, and to');
    }
    return coreOp(swap, { memberId: member, from, to });
  }),
  releaseOccupant: nullableMove(releaseOccupant),
  releaseCalling: entry((request) => {
    const parsed = unwrap(request, ['memberId', 'positionId']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const placed = positionOf(parsed.body.positionId);
    if (member === undefined || placed === undefined) {
      return refuse('releaseCalling requires memberId and positionId');
    }
    return coreOp(releaseCalling, { memberId: member, positionId: placed });
  }),
  moveToDugout: entry((request) => {
    const parsed = unwrap(request, ['memberId', 'from']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const from = positionOf(parsed.body.from);
    if (member === undefined || from === undefined) {
      return refuse('moveToDugout requires memberId and from');
    }
    return coreOp(moveToDugout, { memberId: member, from });
  }),
  addToDugout: entry((request) => {
    const parsed = unwrap(request, ['memberId']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    if (member === undefined) return refuse('addToDugout requires memberId');
    return coreOp(addToDugout, { memberId: member });
  }),
  addCallingGroup: entry((request) => {
    const parsed = unwrap(request, ['parent', 'name', 'kind']);
    if (!parsed.matched) return parsed.prepared;
    const groupParent = parent(parsed.body.parent);
    const name = text(parsed.body.name);
    const kind = text(parsed.body.kind);
    if (groupParent === undefined || name === undefined || kind === undefined) {
      return refuse('addCallingGroup requires parent, name, and kind');
    }
    return coreOp(addCallingGroup, { parent: groupParent, name, kind });
  }),
  renameGroup: entry((request) => {
    const parsed = unwrap(request, ['target', 'name']);
    if (!parsed.matched) return parsed.prepared;
    const target = parent(parsed.body.target);
    const name = text(parsed.body.name);
    if (target === undefined || name === undefined) {
      return refuse('renameGroup requires target and name');
    }
    return coreOp(renameGroup, { target, name });
  }),
  setBoardGroupVisible: entry((request) => {
    const parsed = unwrap(request, ['boardGroupId', 'visible']);
    if (!parsed.matched) return parsed.prepared;
    const id = text(parsed.body.boardGroupId);
    const visible = flag(parsed.body.visible);
    if (id === undefined || visible === undefined) {
      return refuse('setBoardGroupVisible requires boardGroupId and visible');
    }
    return coreOp(setBoardGroupVisible, { boardGroupId: boardGroupId(id), visible });
  }),
  moveGroup: entry((request) => {
    const parsed = unwrap(request, ['target', 'toIndex']);
    if (!parsed.matched) return parsed.prepared;
    const target = parent(parsed.body.target);
    const toIndex = integer(parsed.body.toIndex);
    if (target === undefined || toIndex === undefined) {
      return refuse('moveGroup requires target and an integer toIndex');
    }
    return coreOp(moveGroup, { target, toIndex });
  }),
  addAssignment: entry((request) => {
    const keys = isRecord(request) && Object.hasOwn(request, 'genderRule')
      ? ['groupId', 'title', 'type', 'positionCount', 'genderRule']
      : ['groupId', 'title', 'type', 'positionCount'];
    const parsed = unwrap(request, keys);
    if (!parsed.matched) return parsed.prepared;
    const group = text(parsed.body.groupId);
    const title = text(parsed.body.title);
    const type = assignmentTypeOf(parsed.body.type);
    const positionCount = integer(parsed.body.positionCount);
    if (group === undefined || title === undefined || type === undefined || positionCount === undefined) {
      return refuse('addAssignment requires groupId, title, type, and positionCount');
    }
    let genderRule: CallingGenderRule | undefined;
    if (Object.hasOwn(parsed.body, 'genderRule')) {
      const rawGender = parsed.body.genderRule;
      if (typeof rawGender !== 'string' || !CALLING_GENDER_RULES.includes(rawGender as CallingGenderRule)) {
        return refuse(`genderRule must be one of ${CALLING_GENDER_RULES.join(', ')}`);
      }
      genderRule = rawGender as CallingGenderRule;
    }
    return coreOp(addAssignment, {
      groupId: callingGroupId(group),
      title,
      type,
      positionCount,
      ...(genderRule !== undefined ? { genderRule } : {}),
    });
  }),
  addListPosition: entry((request) => {
    const parsed = unwrap(request, ['assignmentId']);
    if (!parsed.matched) return parsed.prepared;
    const id = assignmentOf(parsed.body.assignmentId);
    if (id === undefined) return refuse('addListPosition requires assignmentId');
    return coreOp(addListPosition, { assignmentId: id });
  }),
  removePosition: entry((request) => {
    const parsed = unwrap(request, ['positionId']);
    if (!parsed.matched) return parsed.prepared;
    const id = positionOf(parsed.body.positionId);
    if (id === undefined) return refuse('removePosition requires positionId');
    return coreOp(removePosition, { positionId: id });
  }),
  removeAssignment: entry((request) => {
    const parsed = unwrap(request, ['assignmentId']);
    if (!parsed.matched) return parsed.prepared;
    const id = assignmentOf(parsed.body.assignmentId);
    if (id === undefined) return refuse('removeAssignment requires assignmentId');
    return coreOp(removeAssignment, { assignmentId: id });
  }),
  approvePlacement: entry((request) => {
    const parsed = unwrap(request, ['memberId', 'positionId']);
    if (!parsed.matched) return parsed.prepared;
    const member = memberOf(parsed.body.memberId);
    const placed = positionOf(parsed.body.positionId);
    if (member === undefined || placed === undefined) {
      return refuse('approvePlacement requires only memberId and positionId');
    }
    return accept((board, deps) => {
      // Approver, time, and baseline come from the server, never the client.
      if (deps.baseline === null) {
        return { ok: false, code: 'not_found', message: `proposal baseline for board ${board.id} does not exist` };
      }
      return fromOutcome(
        approvePlacement(
          board,
          { ward: deps.ward, ids: deps.ids },
          {
            baseline: deps.baseline,
            memberId: member,
            positionId: placed,
            approvedBy: userId(deps.actorId),
            approvedAt: deps.approvedAt,
          },
        ),
      );
    });
  }),
  setCallingTags: entry((request) => tagEdit(request, setCallingTags)),
  setCallingPreferences: entry((request) => tagEdit(request, setCallingPreferences)),
  setOversight: entry((request) => {
    const parsed = unwrap(request, ['target', 'overseer']);
    if (!parsed.matched) return parsed.prepared;
    const target = parent(parsed.body.target);
    const overseer = overseerValue(parsed.body.overseer);
    if (target === undefined || overseer === undefined) {
      return refuse('setOversight requires a boardGroup or callingGroup target and an overseer');
    }
    return coreOp(applySetOversight, { target, overseer });
  }),
  clearOversight: entry((request) => {
    const parsed = unwrap(request, ['target']);
    if (!parsed.matched) return parsed.prepared;
    const target = parent(parsed.body.target);
    if (target === undefined) {
      return refuse('clearOversight requires a boardGroup or callingGroup target');
    }
    return coreOp(applyClearOversight, { target });
  }),
} satisfies Record<string, RegistryEntry>;

function tagEdit(
  request: unknown,
  run: (board: Board, ward: Ward, assignmentId: AssignmentId, tagIds: readonly TagId[]) => CoreResult,
): Prepared {
  const parsed = unwrap(request, ['assignmentId', 'tagIds']);
  if (!parsed.matched) return parsed.prepared;
  const id = assignmentOf(parsed.body.assignmentId);
  const tags = texts(parsed.body.tagIds);
  if (id === undefined || tags === undefined) {
    return refuse('request must have assignmentId and a list of tag ids');
  }
  const tagIds = tags.map((item) => tagId(item));
  return accept((board, deps) => fromOutcome(run(board, deps.ward, id, tagIds)));
}

export function prepareOperation(kind: string, request: unknown): Prepared {
  if (!isRegistered(kind)) {
    return { ok: false, code: 'unknown_operation', message: `unknown operation ${kind}` };
  }
  return operationRegistry[kind].prepare(request);
}

function isRegistered(kind: string): kind is OpKind {
  return Object.hasOwn(operationRegistry, kind);
}
