import {
  assignmentId,
  boardGroupId,
  callingGroupId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  type AssignmentId,
  type BoardGroup,
  type BoardGroupId,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type ExternalCalling,
  type Member,
  type MemberId,
  type Position,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import type { ExternalCallingRef, PersonDecision } from '@wardboard/importer';
import { classifyAssignment, classifyCallingGroup } from './roles.ts';
import type { ApplyImportInput, ApplyImportResult, ImportResolution, StructureRef } from './types.ts';

type Choice =
  | { readonly kind: 'existing'; readonly memberId: string; readonly decision: PersonDecision }
  | { readonly kind: 'new'; readonly category: 'adult' | 'youth'; readonly decision: PersonDecision };

function failureMessage(errors: readonly { path: string; message: string }[]): string {
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ');
}

function unitOf(calling: ExternalCallingRef): string {
  if (calling.servingUnit !== null && calling.servingUnit.trim() !== '') return calling.servingUnit;
  if (calling.section === 'stake') return 'Stake';
  if (calling.section === 'living-outside-unit') return 'Living outside of Unit';
  return 'Serving outside of Unit';
}

function externalOf(decision: PersonDecision): ExternalCalling[] {
  return decision.externalCallings.map((calling) => ({ unit: unitOf(calling), title: calling.calling }));
}

function categoryForNew(
  decision: PersonDecision,
  resolution: { readonly category?: 'adult' | 'youth' },
): 'adult' | 'youth' | null {
  if (decision.category !== null) {
    if (resolution.category !== undefined && resolution.category !== decision.category) return null;
    return decision.category;
  }
  return resolution.category ?? null;
}

function memberOf(ward: Ward, id: string): Member | undefined {
  return ward.members[memberId(id)];
}

function choose(decision: PersonDecision, resolution: ImportResolution | undefined, ward: Ward): Choice | null {
  if (decision.kind === 'matched') {
    const stored = memberOf(ward, decision.memberId);
    if (stored === undefined) return null;
    if (stored.removedDate === null) {
      if (resolution === undefined) return { kind: 'existing', memberId: decision.memberId, decision };
      if (resolution.action === 'match' && resolution.memberId === decision.memberId) {
        return { kind: 'existing', memberId: decision.memberId, decision };
      }
      return null;
    }
    if (
      resolution?.action === 'match' &&
      resolution.memberId === decision.memberId &&
      resolution.confirmReturn === true
    ) {
      return { kind: 'existing', memberId: decision.memberId, decision };
    }
    if (resolution?.action === 'new') {
      const category = categoryForNew(decision, resolution);
      if (category === null) return null;
      return { kind: 'new', category, decision };
    }
    return null;
  }

  if (decision.kind === 'new') {
    if (decision.category !== null && resolution === undefined) {
      return { kind: 'new', category: decision.category, decision };
    }
    if (resolution?.action !== 'new') return null;
    const category = categoryForNew(decision, resolution);
    if (category === null) return null;
    return { kind: 'new', category, decision };
  }

  if (decision.reason === 'report_conflict') {
    if (resolution?.action !== 'new') return null;
    const category = categoryForNew(decision, resolution);
    if (category === null) return null;
    return { kind: 'new', category, decision };
  }

  if (resolution?.action === 'match') {
    const listed = decision.candidates.some((candidate) => candidate.memberId === resolution.memberId);
    if (!listed || memberOf(ward, resolution.memberId) === undefined) return null;
    return { kind: 'existing', memberId: resolution.memberId, decision };
  }
  if (resolution?.action === 'new') {
    const category = categoryForNew(decision, resolution);
    if (category === null) return null;
    return { kind: 'new', category, decision };
  }
  return null;
}

function earlierDate(current: string | null, reportDate: string): string {
  if (current === null || reportDate < current) return reportDate;
  return current;
}

function resolveRef(ref: StructureRef, ids: ReadonlyMap<string, string>): string {
  if (ref.kind === 'existing') return ref.id;
  const real = ids.get(ref.tempId);
  if (real === undefined) throw new Error(`missing import id ${ref.tempId}`);
  return real;
}

export function applyImport(input: ApplyImportInput): ApplyImportResult {
  if (input.plan.duplicates.length > 0) return { ok: false, error: 'duplicate_report' };
  if (input.plan.inconsistentReports) return { ok: false, error: 'inconsistent_reports' };

  const choices: Choice[] = [];
  for (const decision of input.plan.decisions) {
    const choice = choose(decision, input.resolutions[decision.key], input.plan.ward);
    if (choice === null) return { ok: false, error: 'unresolved' };
    choices.push(choice);
  }
  if (input.expectedVersion !== input.plan.currentVersion) {
    return { ok: false, error: 'stale', currentVersion: input.plan.currentVersion };
  }

  const matchedIds = new Set<string>();
  for (const choice of choices) {
    if (choice.kind === 'existing') matchedIds.add(choice.memberId);
  }

  const members: Record<MemberId, Member> = {};
  for (const existing of Object.values(input.plan.ward.members)) members[existing.id] = existing;

  const remove = new Set<string>();
  for (const absent of input.plan.absent) remove.add(absent.memberId);
  for (const decision of input.plan.decisions) {
    if (decision.kind !== 'ambiguous' || decision.reason === 'report_conflict') continue;
    for (const candidate of decision.candidates) {
      if (!matchedIds.has(candidate.memberId)) remove.add(candidate.memberId);
    }
  }
  for (const id of matchedIds) remove.delete(id);

  let removed = 0;
  for (const id of remove) {
    const existing = memberOf(input.plan.ward, id);
    if (existing === undefined) continue;
    const removedDate = earlierDate(existing.removedDate, input.plan.reportDate);
    if (existing.removedDate === null) removed += 1;
    members[existing.id] = { ...existing, removedDate };
  }

  const placedByKey = new Map<string, MemberId>();
  let created = 0;
  for (const choice of choices) {
    if (choice.kind === 'existing') {
      const existing = members[memberId(choice.memberId)];
      if (existing === undefined) return { ok: false, error: 'unresolved' };
      const updated: Member = {
        ...existing,
        name: choice.decision.name,
        category: choice.decision.category ?? existing.category,
        externalCallings: externalOf(choice.decision),
        removedDate: null,
      };
      members[updated.id] = updated;
      placedByKey.set(choice.decision.key, updated.id);
      continue;
    }
    const id = memberId(input.ids());
    created += 1;
    const added: Member = {
      id,
      name: choice.decision.name,
      category: choice.category,
      photoRef: null,
      note: null,
      tagIds: [],
      needsApproval: false,
      removedDate: null,
      externalCallings: externalOf(choice.decision),
    };
    members[id] = added;
    placedByKey.set(choice.decision.key, id);
  }

  const realIds = new Map<string, string>();
  for (const creation of input.plan.creations) {
    realIds.set(creation.tempId, input.ids());
    if (creation.kind === 'position') realIds.set(`${creation.tempId}:lineage`, input.ids());
  }

  const boardGroups: Record<BoardGroupId, BoardGroup> = {};
  for (const group of Object.values(input.plan.current.boardGroups)) boardGroups[group.id] = group;
  const callingGroups: Record<CallingGroupId, CallingGroup> = {};
  for (const group of Object.values(input.plan.current.callingGroups)) callingGroups[group.id] = group;
  const assignments: Record<AssignmentId, CallingAssignment> = {};
  for (const assignment of Object.values(input.plan.current.assignments)) assignments[assignment.id] = assignment;
  const positions: Record<PositionId, Position> = {};
  for (const position of Object.values(input.plan.current.positions)) positions[position.id] = position;

  for (const creation of input.plan.creations) {
    const id = realIds.get(creation.tempId);
    if (id === undefined) throw new Error(`missing import id ${creation.tempId}`);
    if (creation.kind === 'boardGroup') {
      const groupId = boardGroupId(id);
      boardGroups[groupId] = { id: groupId, name: creation.name, order: creation.order, visible: true, key: creation.key };
    } else if (creation.kind === 'callingGroup') {
      const groupId = callingGroupId(id);
      callingGroups[groupId] = {
        id: groupId,
        name: creation.name,
        order: creation.order,
        parent: { kind: 'boardGroup', id: boardGroupId(resolveRef(creation.parent, realIds)) },
        kind: classifyCallingGroup(creation.name),
        key: null,
      };
    } else if (creation.kind === 'assignment') {
      const calling = assignmentId(id);
      const { leadershipRole, prominent } = classifyAssignment(creation.title);
      assignments[calling] = {
        id: calling,
        groupId: callingGroupId(resolveRef(creation.group, realIds)),
        title: creation.title,
        type: creation.type,
        order: creation.order,
        enabled: true,
        prominent,
        origin: 'standard',
        leadershipRole,
        callingTagIds: [],
        preferredMemberTagIds: [],
      };
    } else {
      const lineage = realIds.get(`${creation.tempId}:lineage`);
      if (lineage === undefined) throw new Error(`missing lineage ${creation.tempId}`);
      const slot = positionId(id);
      positions[slot] = {
        id: slot,
        assignmentId: assignmentId(resolveRef(creation.assignment, realIds)),
        lineageId: lineageId(lineage),
        order: creation.order,
      };
    }
  }

  const placements: Record<PositionId, MemberId> = {};
  const listMembers = new Map<string, Set<string>>();
  for (const row of input.plan.rows) {
    if (row.occupant === null || row.conflict || row.decisionKey === null) continue;
    const occupant = placedByKey.get(row.decisionKey);
    if (occupant === undefined) return { ok: false, error: 'unresolved' };
    const assignment = resolveRef(row.assignment, realIds);
    if (row.assignmentType === 'list') {
      const seen = listMembers.get(assignment) ?? new Set<string>();
      listMembers.set(assignment, seen);
      if (seen.has(occupant)) continue;
      seen.add(occupant);
    }
    placements[positionId(resolveRef(row.position, realIds))] = occupant;
  }

  const approvals = input.plan.current.approvals.filter(
    (approval) => placements[approval.positionId] === approval.memberId,
  );
  const wardResult = createWard({ members, tags: input.plan.ward.tags });
  if (!wardResult.ok) throw new Error(failureMessage(wardResult.errors));
  const currentResult = createBoard(
    {
      id: input.plan.current.id,
      kind: 'current',
      version: input.expectedVersion + 1,
      boardGroups,
      callingGroups,
      assignments,
      positions,
      placements,
      oversight: [...input.plan.current.oversight],
      dugoutInclusions: [...input.plan.current.dugoutInclusions],
      approvals,
    },
    wardResult.value,
  );
  if (!currentResult.ok) throw new Error(failureMessage(currentResult.errors));

  const importedAt = input.clock().toISOString();
  return {
    ok: true,
    ward: wardResult.value,
    current: currentResult.value,
    importVersion: [
      input.plan.fingerprints.organizations,
      input.plan.fingerprints['without-callings'],
      input.plan.fingerprints['out-of-unit'],
    ].join('.'),
    importedAt,
    matched: matchedIds.size,
    created,
    removed,
  };
}
