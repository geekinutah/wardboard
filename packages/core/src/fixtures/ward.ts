import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createProposal,
  createWard,
  lineageId,
  memberId,
  positionId,
  proposalId,
  sequentialIds,
  tagId,
  type AssignmentId,
  type AssignmentOrigin,
  type AssignmentType,
  type Board,
  type BoardGroup,
  type BoardGroupId,
  type BoardGroupKey,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type CallingGroupKind,
  type CallingGroupParent,
  type ExternalCalling,
  type LeadershipRole,
  type Member,
  type MemberCategory,
  type MemberId,
  type Overseer,
  type Oversight,
  type Position,
  type PositionId,
  type Proposal,
  type ProposalInput,
  type Result,
  type Tag,
  type TagId,
  type Ward,
} from '../model/index.ts';

/*
 * A deterministic, entirely fictional ward. Every name below is invented for
 * tests and demos; nothing here comes from Church systems or real people.
 */

/** Fixed timestamp used for every fixture time. */
export const FIXTURE_TIME = '2026-01-04T12:00:00Z';

// ---------------------------------------------------------------------------
// Declarative description
// ---------------------------------------------------------------------------

const TAG_NAMES = ['Musical', 'Teaches well', 'Weekday availability', 'New move-in', 'Spanish speaker'] as const;
type TagName = (typeof TAG_NAMES)[number];

interface MemberSpec {
  readonly name: string;
  readonly category: MemberCategory;
  readonly tags?: readonly TagName[];
  readonly needsApproval?: boolean;
  readonly note?: string;
  readonly externalCallings?: readonly ExternalCalling[];
}

const MEMBERS: readonly MemberSpec[] = [
  // Adults
  { name: 'Ada Fictional', category: 'adult' },
  { name: 'Ben Example', category: 'adult' },
  { name: 'Cal Sample', category: 'adult' },
  { name: 'Dora Placeholder', category: 'adult' },
  { name: 'Eli Mockup', category: 'adult' },
  { name: 'Faye Pretend', category: 'adult' },
  { name: 'Gwen Imaginary', category: 'adult' },
  { name: 'Hana Madeup', category: 'adult', tags: ['Spanish speaker'] },
  { name: 'Iris Demo', category: 'adult' },
  { name: 'Jo Testwell', category: 'adult', tags: ['Teaches well'] },
  { name: 'Kit Notreal', category: 'adult' },
  { name: 'Lena Storybook', category: 'adult' },
  { name: 'Max Fictional', category: 'adult' },
  { name: 'Ned Example', category: 'adult' },
  { name: 'Otto Sample', category: 'adult' },
  { name: 'Pete Placeholder', category: 'adult' },
  { name: 'Quinn Mockup', category: 'adult', tags: ['Teaches well'] },
  { name: 'Rex Pretend', category: 'adult', tags: ['Weekday availability'] },
  { name: 'Sam Imaginary', category: 'adult' },
  { name: 'Ted Madeup', category: 'adult', tags: ['Weekday availability'] },
  { name: 'Uma Demo', category: 'adult' },
  { name: 'Vera Testwell', category: 'adult' },
  { name: 'Wren Notreal', category: 'adult' },
  { name: 'Xena Storybook', category: 'adult' },
  { name: 'Yara Fictional', category: 'adult' },
  { name: 'Zoe Example', category: 'adult', tags: ['Spanish speaker'] },
  { name: 'Ari Sample', category: 'adult' },
  { name: 'Bea Placeholder', category: 'adult', tags: ['Teaches well'] },
  { name: 'Cy Mockup', category: 'adult', needsApproval: true },
  { name: 'Dee Pretend', category: 'adult' },
  { name: 'Ezra Imaginary', category: 'adult', tags: ['Teaches well'] },
  { name: 'Flo Madeup', category: 'adult', tags: ['Musical'] },
  { name: 'Gus Demo', category: 'adult', tags: ['Musical'] },
  {
    name: 'Hal Testwell',
    category: 'adult',
    externalCallings: [{ unit: 'Example Stake', title: 'Stake Family History Consultant' }],
  },
  { name: 'Ivy Notreal', category: 'adult', tags: ['Musical', 'Teaches well'] },
  {
    name: 'Jay Storybook',
    category: 'adult',
    tags: ['Weekday availability'],
    note: 'Travels for work most weekdays in March.',
  },
  {
    name: 'Kai Fictional',
    category: 'adult',
    tags: ['New move-in', 'Spanish speaker'],
    externalCallings: [{ unit: 'Example Stake', title: 'Stake Young Single Adult Adviser' }],
  },
  { name: 'Liv Example', category: 'adult' },
  // Youth
  { name: 'Mia Sample', category: 'youth' },
  { name: 'Nico Placeholder', category: 'youth' },
  { name: 'Ola Mockup', category: 'youth' },
  { name: 'Pax Pretend', category: 'youth' },
  { name: 'Ray Imaginary', category: 'youth' },
  { name: 'Sia Madeup', category: 'youth' },
  { name: 'Tai Demo', category: 'youth', tags: ['Musical'] },
];

/** Every member name the fixture may use. All are invented. */
export const FIXTURE_MEMBER_NAMES: readonly string[] = MEMBERS.map((m) => m.name);

interface AssignmentSpec {
  readonly title: string;
  readonly type: AssignmentType;
  /** One entry per position: the occupant's name, or null for a vacancy. */
  readonly positions: readonly (string | null)[];
  readonly prominent?: boolean;
  readonly origin?: AssignmentOrigin;
  readonly leadershipRole?: LeadershipRole;
  readonly callingTags?: readonly TagName[];
  readonly preferredTags?: readonly TagName[];
}

type AssignmentExtras = Omit<AssignmentSpec, 'title' | 'type' | 'positions'>;

interface CallingGroupSpec {
  readonly name: string;
  readonly kind: CallingGroupKind;
  readonly key: string | null;
  readonly assignments: readonly AssignmentSpec[];
}

interface BoardGroupSpec {
  readonly key: BoardGroupKey;
  readonly name: string;
  readonly groups: readonly CallingGroupSpec[];
}

function single(title: string, occupant: string | null, extras: AssignmentExtras = {}): AssignmentSpec {
  return { title, type: 'single', positions: [occupant], ...extras };
}

function list(title: string, occupants: readonly (string | null)[], extras: AssignmentExtras = {}): AssignmentSpec {
  return { title, type: 'list', positions: occupants, ...extras };
}

/** A presidency: president, two counselors, and a secretary, each with its leadership role. */
function presidency(
  president: string | null,
  first: string | null,
  second: string | null,
  secretary: string | null,
): AssignmentSpec[] {
  return [
    single('President', president, { prominent: true, leadershipRole: 'president' }),
    single('First Counselor', first, { prominent: true, leadershipRole: 'counselor' }),
    single('Second Counselor', second, { prominent: true, leadershipRole: 'counselor' }),
    single('Secretary', secretary, { leadershipRole: 'secretary' }),
  ];
}

const BOARD_GROUPS: readonly BoardGroupSpec[] = [
  {
    key: 'bishopric',
    name: 'Bishopric',
    groups: [
      {
        name: 'Bishopric',
        kind: 'bishopric',
        key: 'bishopric',
        assignments: [
          single('Bishop', 'Ada Fictional', { prominent: true, leadershipRole: 'president' }),
          single('First Counselor', 'Ben Example', { prominent: true, leadershipRole: 'counselor' }),
          single('Second Counselor', 'Cal Sample', { prominent: true, leadershipRole: 'counselor' }),
        ],
      },
      {
        name: 'Clerks and Secretaries (support roles)',
        kind: 'other',
        key: 'bishopric_support',
        assignments: [single('Ward Clerk', 'Dora Placeholder'), single('Executive Secretary', 'Eli Mockup')],
      },
    ],
  },
  {
    key: 'elders_quorum',
    name: 'Elders Quorum',
    groups: [
      {
        name: 'Elders Quorum Presidency',
        kind: 'presidency',
        key: 'elders_quorum_presidency',
        assignments: presidency('Max Fictional', 'Ned Example', 'Otto Sample', 'Pete Placeholder'),
      },
      {
        name: 'Elders Quorum Instructors',
        kind: 'class',
        key: null,
        assignments: [list('Elders Quorum Instructor', ['Quinn Mockup', null], { preferredTags: ['Teaches well'] })],
      },
    ],
  },
  {
    key: 'relief_society',
    name: 'Relief Society',
    groups: [
      {
        name: 'Relief Society Presidency',
        kind: 'presidency',
        key: 'relief_society_presidency',
        assignments: presidency('Faye Pretend', 'Gwen Imaginary', 'Hana Madeup', 'Iris Demo'),
      },
      {
        name: 'Relief Society Teachers',
        kind: 'class',
        key: 'relief_society_teachers',
        assignments: [list('Relief Society Teacher', ['Jo Testwell', 'Kit Notreal', 'Lena Storybook', null])],
      },
    ],
  },
  {
    key: 'aaronic_priesthood',
    name: 'Young Men / Aaronic Priesthood',
    groups: [
      {
        // The bishop presides over the priests quorum by office. That is the
        // fixed oversight entry, not a calling slot in this group.
        name: 'Priests Quorum',
        kind: 'quorum',
        key: 'priests_quorum',
        assignments: [
          single('First Assistant', 'Mia Sample'),
          single('Second Assistant', 'Nico Placeholder'),
          single('Priests Quorum Adviser', 'Rex Pretend', { preferredTags: ['Weekday availability'] }),
        ],
      },
      {
        name: 'Teachers Quorum',
        kind: 'quorum',
        key: 'teachers_quorum',
        assignments: [
          single('Teachers Quorum President', 'Ola Mockup', { prominent: true, leadershipRole: 'president' }),
          single('Teachers Quorum First Counselor', 'Pax Pretend', { leadershipRole: 'counselor' }),
          single('Teachers Quorum Adviser', 'Sam Imaginary', { preferredTags: ['Weekday availability'] }),
        ],
      },
      {
        name: 'Deacons Quorum',
        kind: 'quorum',
        key: 'deacons_quorum',
        assignments: [
          single('Deacons Quorum President', 'Ray Imaginary', { prominent: true, leadershipRole: 'president' }),
          single('Deacons Quorum First Counselor', null, { leadershipRole: 'counselor' }),
          single('Deacons Quorum Adviser', 'Ted Madeup', {
            callingTags: ['Weekday availability'],
            preferredTags: ['Weekday availability'],
          }),
        ],
      },
    ],
  },
  {
    key: 'young_women',
    name: 'Young Women',
    groups: [
      {
        name: 'Young Women Presidency',
        kind: 'presidency',
        key: 'young_women_presidency',
        assignments: presidency('Uma Demo', 'Vera Testwell', 'Wren Notreal', null),
      },
      {
        name: 'Young Women Class',
        kind: 'class',
        key: null,
        assignments: [single('Class President', 'Sia Madeup'), list('Young Women Adviser', ['Xena Storybook', null])],
      },
    ],
  },
  {
    key: 'primary',
    name: 'Primary',
    groups: [
      {
        name: 'Primary Presidency',
        kind: 'presidency',
        key: 'primary_presidency',
        assignments: presidency('Yara Fictional', 'Zoe Example', 'Ari Sample', null),
      },
      {
        name: 'Primary Teachers',
        kind: 'class',
        key: null,
        assignments: [
          list('Primary Teacher', ['Bea Placeholder', 'Cy Mockup', null, null], {
            callingTags: ['Teaches well'],
            preferredTags: ['Teaches well'],
          }),
        ],
      },
      {
        name: 'Nursery',
        kind: 'class',
        key: null,
        // Jo Testwell is also a Relief Society teacher: the fixture's member with two callings.
        assignments: [list('Nursery Leader', ['Jo Testwell', null])],
      },
    ],
  },
  {
    key: 'sunday_school',
    name: 'Sunday School',
    groups: [
      {
        name: 'Sunday School Presidency',
        kind: 'presidency',
        key: 'sunday_school_presidency',
        assignments: [
          single('President', 'Dee Pretend', { prominent: true, leadershipRole: 'president' }),
          single('First Counselor', null, { prominent: true, leadershipRole: 'counselor' }),
          single('Secretary', null),
        ],
      },
      {
        name: 'Gospel Doctrine',
        kind: 'class',
        key: null,
        assignments: [list('Gospel Doctrine Teacher', ['Ezra Imaginary', null], { preferredTags: ['Teaches well'] })],
      },
      {
        name: 'Youth Sunday School',
        kind: 'class',
        key: null,
        assignments: [list('Youth Sunday School Teacher', [null, null])],
      },
    ],
  },
  {
    key: 'ward_wide',
    name: 'Ward-wide Callings',
    groups: [
      {
        name: 'Music',
        kind: 'committee',
        key: 'music',
        assignments: [
          single('Music Coordinator', 'Flo Madeup', { prominent: true }),
          single('Organist', 'Gus Demo', { callingTags: ['Musical'], preferredTags: ['Musical'] }),
          single('Chorister', null, { preferredTags: ['Musical'] }),
        ],
      },
      {
        name: 'Temple and Family History',
        kind: 'committee',
        key: 'temple_family_history',
        assignments: [list('Temple and Family History Consultant', ['Hal Testwell', null])],
      },
      {
        name: 'Other Ward Callings',
        kind: 'other',
        key: 'other_ward_callings',
        assignments: [single('Livestream Coordinator', 'Liv Example', { origin: 'custom' })],
      },
    ],
  },
];

type OversightTargetSpec =
  | { readonly kind: 'boardGroup'; readonly key: BoardGroupKey }
  | { readonly kind: 'callingGroup'; readonly key: string };

/** SPEC §4 proposed default oversight seed, by group key. */
const OVERSIGHT: readonly { readonly overseer: Overseer; readonly target: OversightTargetSpec; readonly fixed: boolean }[] = [
  { overseer: 'bishop', target: { kind: 'callingGroup', key: 'priests_quorum' }, fixed: true },
  { overseer: 'first_counselor', target: { kind: 'callingGroup', key: 'teachers_quorum' }, fixed: false },
  { overseer: 'first_counselor', target: { kind: 'boardGroup', key: 'sunday_school' }, fixed: false },
  { overseer: 'second_counselor', target: { kind: 'callingGroup', key: 'deacons_quorum' }, fixed: false },
  { overseer: 'second_counselor', target: { kind: 'boardGroup', key: 'primary' }, fixed: false },
];

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`fixture ${what} is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`fixture references unknown ${what}`);
  }
  return value;
}

function buildWard(): Ward {
  const nextTag = sequentialIds('t');
  const nextMember = sequentialIds('m');

  const tags: Record<TagId, Tag> = {};
  const tagIdByName = new Map<string, TagId>();
  for (const name of TAG_NAMES) {
    const id = tagId(nextTag());
    tags[id] = { id, name };
    tagIdByName.set(name, id);
  }

  const members: Record<MemberId, Member> = {};
  for (const spec of MEMBERS) {
    const id = memberId(nextMember());
    members[id] = {
      id,
      name: spec.name,
      category: spec.category,
      photoRef: null,
      note: spec.note ?? null,
      tagIds: (spec.tags ?? []).map((name) => required(tagIdByName.get(name), `tag ${name}`)),
      needsApproval: spec.needsApproval ?? false,
      removedDate: null,
      externalCallings: spec.externalCallings ?? [],
    };
  }
  return unwrap(createWard({ members, tags }), 'ward');
}

function buildCurrent(ward: Ward): Board {
  const nextBoardGroup = sequentialIds('bg');
  const nextCallingGroup = sequentialIds('cg');
  const nextAssignment = sequentialIds('a');
  const nextPosition = sequentialIds('p');
  const nextLineage = sequentialIds('ln');

  const memberIdByName = new Map(Object.values(ward.members).map((m) => [m.name, m.id]));
  const tagIdByName = new Map(Object.values(ward.tags).map((t) => [t.name, t.id]));
  const tagIds = (names: readonly TagName[] | undefined): TagId[] =>
    (names ?? []).map((name) => required(tagIdByName.get(name), `tag ${name}`));

  const boardGroups: Record<BoardGroupId, BoardGroup> = {};
  const callingGroups: Record<CallingGroupId, CallingGroup> = {};
  const assignments: Record<AssignmentId, CallingAssignment> = {};
  const positions: Record<PositionId, Position> = {};
  const placements: Record<PositionId, MemberId> = {};

  const addCallingGroup = (spec: CallingGroupSpec, parent: CallingGroupParent, order: number): void => {
    const groupId = callingGroupId(nextCallingGroup());
    callingGroups[groupId] = { id: groupId, name: spec.name, order, parent, kind: spec.kind, key: spec.key };
    spec.assignments.forEach((assignment, assignmentOrder) => {
      const id = assignmentId(nextAssignment());
      assignments[id] = {
        id,
        groupId,
        title: assignment.title,
        type: assignment.type,
        order: assignmentOrder,
        enabled: true,
        prominent: assignment.prominent ?? false,
        origin: assignment.origin ?? 'standard',
        leadershipRole: assignment.leadershipRole ?? null,
        callingTagIds: tagIds(assignment.callingTags),
        preferredMemberTagIds: tagIds(assignment.preferredTags),
      };
      assignment.positions.forEach((occupant, positionOrder) => {
        const pId = positionId(nextPosition());
        positions[pId] = { id: pId, assignmentId: id, lineageId: lineageId(nextLineage()), order: positionOrder };
        if (occupant !== null) {
          placements[pId] = required(memberIdByName.get(occupant), `member ${occupant}`);
        }
      });
    });
  };

  BOARD_GROUPS.forEach((spec, order) => {
    const id = boardGroupId(nextBoardGroup());
    boardGroups[id] = { id, name: spec.name, order, visible: true, key: spec.key };
    spec.groups.forEach((group, groupOrder) => {
      addCallingGroup(group, { kind: 'boardGroup', id }, groupOrder);
    });
  });

  const boardGroupIdByKey = new Map(Object.values(boardGroups).map((g) => [g.key, g.id]));
  const callingGroupIdByKey = new Map(Object.values(callingGroups).map((g) => [g.key, g.id]));
  const oversight: Oversight[] = OVERSIGHT.map(({ overseer, target, fixed }) => ({
    overseer,
    fixed,
    target:
      target.kind === 'boardGroup'
        ? { kind: 'boardGroup', id: required(boardGroupIdByKey.get(target.key), `board group ${target.key}`) }
        : { kind: 'callingGroup', id: required(callingGroupIdByKey.get(target.key), `calling group ${target.key}`) },
  }));

  const board: Board = {
    id: boardId('b-current'),
    kind: 'current',
    version: 1,
    boardGroups,
    callingGroups,
    assignments,
    positions,
    placements,
    oversight,
    dugoutInclusions: [],
    approvals: [],
  };
  return unwrap(createBoard(board, ward), 'current board');
}

/**
 * Builds the fictional fixture ward and its Current board. Deterministic: every
 * call returns deep-equal, deeply frozen values.
 */
export function buildFixtureWard(): { readonly ward: Ward; readonly current: Board } {
  const ward = buildWard();
  return { ward, current: buildCurrent(ward) };
}

/** Proposal fields a caller may override. Board ids derive from the proposal id. */
export type FixtureProposalOverrides = Partial<
  Pick<ProposalInput, 'id' | 'name' | 'rationale' | 'tabOrder' | 'createdAt' | 'updatedAt'>
>;

/**
 * Starts a Draft proposal from `current`: its baseline and working board are
 * structurally equal, independent copies of Current with their own board ids
 * (`<proposal id>-baseline`, `<proposal id>-board`) and kinds.
 */
export function buildFixtureProposal(current: Board, ward: Ward, overrides: FixtureProposalOverrides = {}): Proposal {
  const id = overrides.id ?? proposalId('pr-0001');
  const input: ProposalInput = {
    id,
    name: 'Spring adjustments',
    rationale: 'Fill Primary and Sunday School vacancies.',
    status: 'draft',
    accepted: null,
    baseline: { ...current, id: boardId(`${id}-baseline`), kind: 'baseline' },
    board: { ...current, id: boardId(`${id}-board`), kind: 'proposal' },
    tabOrder: 0,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  };
  return unwrap(createProposal(input, ward), 'proposal');
}
