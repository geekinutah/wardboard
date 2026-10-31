import type { AssignmentId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, CallingAssignment, CallingGenderRule, MemberGender, Ward } from '../model/types.ts';

/*
 * Handbook calling gender (SPEC §5). `classifyCallingGender` is the default
 * rule for an organization and title. `canPlaceMemberInAssignment` enforces a
 * stored rule against the board it is given, including Sunday School
 * presidency alignment after presidency release.
 */

const PRIMARY_LEADERSHIP = ['president', 'first counselor', 'second counselor', 'secretary'] as const;
const PRIMARY_EXCLUDED = ['activity', 'music', 'teacher', 'nursery'] as const;

const SUNDAY_SCHOOL_PRESIDENCY = new Set<string>([
  'president',
  'sunday school president',
  'first counselor',
  'sunday school first counselor',
  'second counselor',
  'sunday school second counselor',
  'secretary',
  'sunday school secretary',
]);

const MALE_TITLES = new Set<string>([
  'ward mission leader',
  'assistant ward mission leader',
  'ward temple and family history leader',
  'priesthood music director',
]);

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isMaleOrganization(organization: string): boolean {
  return (
    organization.includes('aaronic priesthood') ||
    organization.includes('elders quorum') ||
    organization.includes('bishopric')
  );
}

function isFemaleOrganization(organization: string): boolean {
  return organization.includes('relief society') || organization.includes('young women');
}

function isOrEndsWith(title: string, role: string): boolean {
  return title === role || title.endsWith(` ${role}`);
}

function isPrimaryLeadership(title: string): boolean {
  if (PRIMARY_EXCLUDED.some((word) => title.includes(word))) {
    return false;
  }
  return PRIMARY_LEADERSHIP.some((role) => isOrEndsWith(title, role));
}

/** Default gender rule for a calling, from its organization and title. */
export function classifyCallingGender(organizationName: string, title: string): CallingGenderRule {
  const organization = normalizeLabel(organizationName);
  const calling = normalizeLabel(title);
  if (isMaleOrganization(organization)) {
    return 'M';
  }
  if (isFemaleOrganization(organization)) {
    return 'F';
  }
  if (organization === 'primary') {
    return isPrimaryLeadership(calling) ? 'F' : 'any';
  }
  if (organization === 'sunday school') {
    return SUNDAY_SCHOOL_PRESIDENCY.has(calling) ? 'presidency_aligned' : 'any';
  }
  if (MALE_TITLES.has(calling)) {
    return 'M';
  }
  return 'any';
}

function conflictingPresidencyGender(
  board: Board,
  ward: Ward,
  assignment: CallingAssignment,
  gender: MemberGender,
  ignore: ReadonlySet<PositionId> | undefined,
): MemberGender | null {
  const aligned = new Set<string>();
  for (const candidate of Object.values(board.assignments)) {
    if (candidate.groupId === assignment.groupId && candidate.genderRule === 'presidency_aligned') {
      aligned.add(candidate.id);
    }
  }
  const seats = Object.values(board.positions)
    .filter((position) => aligned.has(position.assignmentId) && ignore?.has(position.id) !== true)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  for (const seat of seats) {
    if (!Object.hasOwn(board.placements, seat.id)) {
      continue;
    }
    const occupant = board.placements[seat.id];
    if (occupant === undefined) {
      continue;
    }
    const occupantGender = ward.members[occupant]?.gender;
    if (occupantGender !== undefined && occupantGender !== gender) {
      return occupantGender;
    }
  }
  return null;
}

/**
 * Whether `memberId` may hold `assignmentId` on this board.
 * A member or calling with no recorded gender is allowed. `presidency_aligned`
 * seats in the same calling group must share one known gender. Positions in
 * `ignorePositions` are not occupants for that comparison.
 */
export function canPlaceMemberInAssignment(
  board: Board,
  ward: Ward,
  memberId: MemberId,
  assignmentId: AssignmentId,
  options?: { readonly ignorePositions?: ReadonlySet<PositionId> },
): { readonly ok: true } | { readonly ok: false; readonly requiredGender: MemberGender; readonly message: string } {
  const member = ward.members[memberId];
  if (member?.gender === undefined) {
    return { ok: true };
  }
  const assignment = board.assignments[assignmentId];
  const rule = assignment?.genderRule ?? 'any';
  if (rule === 'any' || assignment === undefined) {
    return { ok: true };
  }
  if (rule === 'M' || rule === 'F') {
    if (member.gender === rule) {
      return { ok: true };
    }
    return {
      ok: false,
      requiredGender: rule,
      message: `${assignment.title} requires a ${rule === 'M' ? 'male' : 'female'} member`,
    };
  }
  const requiredGender = conflictingPresidencyGender(board, ward, assignment, member.gender, options?.ignorePositions);
  if (requiredGender === null) {
    return { ok: true };
  }
  return {
    ok: false,
    requiredGender,
    message: `${assignment.title} must match the gender of the Sunday School presidency (${requiredGender})`,
  };
}
