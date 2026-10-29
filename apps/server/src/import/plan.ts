import {
  memberId,
  type AssignmentType,
  type Board,
  type BoardGroup,
  type BoardGroupKey,
  type CallingAssignment,
  type CallingGroup,
  type Ward,
} from '@wardboard/core';
import {
  canonicalName,
  reconcile,
  reportFingerprint,
  type ImportBundle,
  type PersonDecision,
} from '@wardboard/importer';
import type {
  ImportFingerprints,
  ImportPlan,
  PlannedCreation,
  PlannedRow,
  StructureRef,
} from './types.ts';

const GROUP_KEYS: Readonly<Record<string, BoardGroupKey>> = {
  bishopric: 'bishopric',
  'elders quorum': 'elders_quorum',
  'relief society': 'relief_society',
  'aaronic priesthood quorums': 'aaronic_priesthood',
  'young women': 'young_women',
  'sunday school': 'sunday_school',
  primary: 'primary',
  'ward missionaries': 'ward_wide',
  'temple and family history': 'ward_wide',
  'young single adult': 'ward_wide',
  'other callings': 'ward_wide',
};

type ReportRow = {
  readonly organization: string;
  readonly group: string;
  readonly title: string;
  readonly occupant: string | null;
};

type Slot = {
  readonly positionId: string;
  readonly assignmentId: string;
  readonly assignmentType: AssignmentType;
  readonly order: number;
};

function mappedKey(canonical: string): BoardGroupKey | undefined {
  if (!Object.hasOwn(GROUP_KEYS, canonical)) return undefined;
  return GROUP_KEYS[canonical];
}

function nextOrder(orders: readonly number[]): number {
  let max = -1;
  for (const order of orders) {
    if (order > max) max = order;
  }
  return max + 1;
}

function refKey(ref: StructureRef): string {
  return ref.kind === 'existing' ? `existing:${ref.id}` : `new:${ref.tempId}`;
}

function rootBoard(current: Board, calling: CallingGroup): BoardGroup | undefined {
  let group: CallingGroup | undefined = calling;
  const seen = new Set<string>();
  while (group !== undefined) {
    if (seen.has(group.id)) return undefined;
    seen.add(group.id);
    if (group.parent.kind === 'boardGroup') return current.boardGroups[group.parent.id];
    group = current.callingGroups[group.parent.id];
  }
  return undefined;
}

function slotsByKey(current: Board): Map<string, Slot[]> {
  const grouped = new Map<string, Slot[]>();
  for (const position of Object.values(current.positions)) {
    const assignment = current.assignments[position.assignmentId];
    if (assignment === undefined) continue;
    const calling = current.callingGroups[assignment.groupId];
    if (calling === undefined) continue;
    const boardGroup = rootBoard(current, calling);
    if (boardGroup === undefined) continue;
    const key = [
      canonicalName(boardGroup.name),
      canonicalName(calling.name),
      canonicalName(assignment.title),
    ].join('\u0000');
    const slots = grouped.get(key) ?? [];
    slots.push({
      positionId: position.id,
      assignmentId: assignment.id,
      assignmentType: assignment.type,
      order: position.order,
    });
    grouped.set(key, slots);
  }
  for (const slots of grouped.values()) {
    slots.sort((left, right) => left.order - right.order || left.positionId.localeCompare(right.positionId));
  }
  return grouped;
}

function reportRows(bundle: ImportBundle): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const organization of bundle.organizations.organizations) {
    for (const group of organization.groups) {
      for (const position of group.positions) {
        rows.push({
          organization: organization.name,
          group: group.name,
          title: position.title,
          occupant: position.occupant,
        });
      }
    }
  }
  return rows;
}

function rowKey(row: ReportRow): string {
  return [canonicalName(row.organization), canonicalName(row.group), canonicalName(row.title)].join('\u0000');
}

export function planImport(input: {
  readonly bundle: ImportBundle;
  readonly ward: Ward;
  readonly current: Board;
  readonly previousFingerprints?: Readonly<Partial<Record<keyof ImportFingerprints, string>>>;
}): ImportPlan {
  const reconciled = reconcile({
    bundle: input.bundle,
    members: Object.values(input.ward.members).map((member) => ({ id: member.id, name: member.name })),
    ...(input.previousFingerprints === undefined
      ? {}
      : { previousFingerprints: input.previousFingerprints }),
  });
  const decisionByKey = new Map<string, PersonDecision>();
  for (const decision of reconciled.decisions) decisionByKey.set(decision.key, decision);

  const returning: { key: string; memberId: string }[] = [];
  const needsCategory: string[] = [];
  for (const decision of reconciled.decisions) {
    if (decision.kind === 'matched') {
      const member = input.ward.members[memberId(decision.memberId)];
      if (member !== undefined && member.removedDate !== null) {
        returning.push({ key: decision.key, memberId: decision.memberId });
      }
    } else if (decision.kind === 'new') {
      if (decision.category === null) needsCategory.push(decision.key);
    } else {
      needsCategory.push(decision.key);
    }
  }

  const rows = reportRows(input.bundle);
  const slots = slotsByKey(input.current);
  const used = new Map<string, number>();
  const taken = new Set<string>();
  const matchedRows: { row: ReportRow; slot: Slot }[] = [];
  const unmatched: ReportRow[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    const available = slots.get(key) ?? [];
    const index = used.get(key) ?? 0;
    const slot = available[index];
    if (slot !== undefined) {
      used.set(key, index + 1);
      taken.add(slot.positionId);
      matchedRows.push({ row, slot });
    } else {
      unmatched.push(row);
    }
  }

  const initialByKey = new Map<BoardGroupKey, string>();
  const initialByName = new Map<string, string>();
  for (const group of Object.values(input.current.boardGroups)) {
    if (group.key !== null && !initialByKey.has(group.key)) initialByKey.set(group.key, group.id);
    const name = canonicalName(group.name);
    if (!initialByName.has(name)) initialByName.set(name, group.id);
  }

  const boardIdentity = (organization: string): string => {
    const canonical = canonicalName(organization);
    const mapped = mappedKey(canonical);
    if (mapped !== undefined) {
      const existing = initialByKey.get(mapped);
      if (existing !== undefined) return `existing:${existing}`;
    }
    const named = initialByName.get(canonical);
    if (named !== undefined) return `existing:${named}`;
    if (mapped !== undefined && !initialByKey.has(mapped)) return `create-key:${mapped}`;
    return `create-name:${canonical}`;
  };

  const slotKey = (row: ReportRow): string =>
    `${boardIdentity(row.organization)}\u0000${canonicalName(row.group)}\u0000${canonicalName(row.title)}`;

  const unmatchedCounts = new Map<string, number>();
  for (const row of unmatched) {
    const key = slotKey(row);
    unmatchedCounts.set(key, (unmatchedCounts.get(key) ?? 0) + 1);
  }

  const callingByBoard = new Map<string, string>();
  for (const group of Object.values(input.current.callingGroups)) {
    const boardGroup = rootBoard(input.current, group);
    if (boardGroup === undefined) continue;
    const key = `${boardGroup.id}\u0000${canonicalName(group.name)}`;
    if (!callingByBoard.has(key)) callingByBoard.set(key, group.id);
  }

  const creations: PlannedCreation[] = [];
  const createdByKey = new Map<BoardGroupKey, StructureRef>();
  const createdByName = new Map<string, StructureRef>();
  const createdCalling = new Map<string, StructureRef>();
  const createdLists = new Map<string, StructureRef>();
  const usedKeys = new Set<BoardGroupKey>(initialByKey.keys());
  const boardOrders = Object.values(input.current.boardGroups).map((group) => group.order);
  const callingOrders = new Map<string, number[]>();
  for (const group of Object.values(input.current.callingGroups)) {
    const boardGroup = rootBoard(input.current, group);
    if (boardGroup === undefined) continue;
    const key = `existing:${boardGroup.id}`;
    const orders = callingOrders.get(key) ?? [];
    orders.push(group.order);
    callingOrders.set(key, orders);
  }
  const assignmentOrders = new Map<string, number[]>();
  for (const assignment of Object.values(input.current.assignments)) {
    const key = `existing:${assignment.groupId}`;
    const orders = assignmentOrders.get(key) ?? [];
    orders.push(assignment.order);
    assignmentOrders.set(key, orders);
  }
  const positionOrders = new Map<string, number[]>();
  for (const position of Object.values(input.current.positions)) {
    const key = `existing:${position.assignmentId}`;
    const orders = positionOrders.get(key) ?? [];
    orders.push(position.order);
    positionOrders.set(key, orders);
  }
  let sequence = 0;
  const tempId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}-${String(sequence)}`;
  };
  const takeOrder = (orders: number[]): number => {
    const order = nextOrder(orders);
    orders.push(order);
    return order;
  };

  const resolveBoardGroup = (organization: string): StructureRef => {
    const canonical = canonicalName(organization);
    const mapped = mappedKey(canonical);
    if (mapped !== undefined) {
      const existing = initialByKey.get(mapped);
      if (existing !== undefined) return { kind: 'existing', id: existing };
      const created = createdByKey.get(mapped);
      if (created !== undefined) return created;
    }
    const named = initialByName.get(canonical);
    if (named !== undefined) return { kind: 'existing', id: named };
    const createdNamed = createdByName.get(canonical);
    if (createdNamed !== undefined) return createdNamed;
    const key = mapped !== undefined && !usedKeys.has(mapped) ? mapped : null;
    const id = tempId('bg');
    const ref: StructureRef = { kind: 'new', tempId: id };
    creations.push({
      kind: 'boardGroup',
      tempId: id,
      name: organization,
      key,
      order: takeOrder(boardOrders),
    });
    if (key !== null) {
      usedKeys.add(key);
      createdByKey.set(key, ref);
    }
    createdByName.set(canonical, ref);
    return ref;
  };

  const resolveCallingGroup = (boardRef: StructureRef, groupName: string): StructureRef => {
    const canonical = canonicalName(groupName);
    if (boardRef.kind === 'existing') {
      const existing = callingByBoard.get(`${boardRef.id}\u0000${canonical}`);
      if (existing !== undefined) return { kind: 'existing', id: existing };
    }
    const key = `${refKey(boardRef)}\u0000${canonical}`;
    const created = createdCalling.get(key);
    if (created !== undefined) return created;
    const id = tempId('cg');
    const ref: StructureRef = { kind: 'new', tempId: id };
    const orders = callingOrders.get(refKey(boardRef)) ?? [];
    callingOrders.set(refKey(boardRef), orders);
    creations.push({
      kind: 'callingGroup',
      tempId: id,
      name: groupName,
      parent: boardRef,
      order: takeOrder(orders),
    });
    createdCalling.set(key, ref);
    return ref;
  };

  const existingOfTitle = (callingRef: StructureRef, title: string): CallingAssignment[] => {
    if (callingRef.kind !== 'existing') return [];
    const canonical = canonicalName(title);
    return Object.values(input.current.assignments).filter(
      (assignment) => assignment.groupId === callingRef.id && canonicalName(assignment.title) === canonical,
    );
  };

  const pushPosition = (assignment: StructureRef, orderKey: string): StructureRef => {
    const orders = positionOrders.get(orderKey) ?? [];
    positionOrders.set(orderKey, orders);
    const id = tempId('ps');
    creations.push({ kind: 'position', tempId: id, assignment, order: takeOrder(orders) });
    return { kind: 'new', tempId: id };
  };

  const pushAssignment = (callingRef: StructureRef, title: string, type: AssignmentType): StructureRef => {
    const orders = assignmentOrders.get(refKey(callingRef)) ?? [];
    assignmentOrders.set(refKey(callingRef), orders);
    const id = tempId('as');
    creations.push({
      kind: 'assignment',
      tempId: id,
      title,
      type,
      group: callingRef,
      order: takeOrder(orders),
    });
    return { kind: 'new', tempId: id };
  };

  const planned = new Map<ReportRow, PlannedRow>();
  for (const item of matchedRows) {
    const decisionKey = item.row.occupant === null ? null : canonicalName(item.row.occupant);
    const decision = decisionKey === null ? undefined : decisionByKey.get(decisionKey);
    planned.set(item.row, {
      ...item.row,
      decisionKey,
      conflict: decision?.kind === 'ambiguous' && decision.reason === 'report_conflict',
      position: { kind: 'existing', id: item.slot.positionId },
      assignment: { kind: 'existing', id: item.slot.assignmentId },
      assignmentType: item.slot.assignmentType,
    });
  }

  const openPosition = (assignmentId: string): string | undefined => {
    const open = Object.values(input.current.positions)
      .filter((position) => position.assignmentId === assignmentId && !taken.has(position.id))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return open[0]?.id;
  };

  let filledExisting = 0;
  const unfamiliar: ImportPlan['unfamiliar'][number][] = [];
  for (const row of unmatched) {
    const boardRef = resolveBoardGroup(row.organization);
    const callingRef = resolveCallingGroup(boardRef, row.group);
    const key = slotKey(row);
    let assignment = createdLists.get(key);
    let assignmentType: AssignmentType = 'list';
    let position: StructureRef | undefined;
    if (assignment === undefined) {
      const existing = existingOfTitle(callingRef, row.title);
      const existingList = existing.find((item) => item.type === 'list');
      if (existingList !== undefined) {
        const open = openPosition(existingList.id);
        if (open !== undefined) {
          assignment = { kind: 'existing', id: existingList.id };
          position = { kind: 'existing', id: open };
          taken.add(open);
          filledExisting += 1;
        } else {
          assignment = { kind: 'existing', id: existingList.id };
        }
      } else {
        const singles = existing
          .filter((item) => item.type === 'single')
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
        for (const single of singles) {
          const open = openPosition(single.id);
          if (open === undefined) continue;
          assignment = { kind: 'existing', id: single.id };
          assignmentType = 'single';
          position = { kind: 'existing', id: open };
          taken.add(open);
          filledExisting += 1;
          break;
        }
        if (assignment === undefined) {
          if (singles.length > 0 || (unmatchedCounts.get(key) ?? 0) > 1) {
            assignment = pushAssignment(callingRef, row.title, 'list');
            createdLists.set(key, assignment);
          } else {
            assignment = pushAssignment(callingRef, row.title, 'single');
            assignmentType = 'single';
          }
        }
      }
    }
    const placed = position ?? pushPosition(assignment, refKey(assignment));
    const decisionKey = row.occupant === null ? null : canonicalName(row.occupant);
    const decision = decisionKey === null ? undefined : decisionByKey.get(decisionKey);
    planned.set(row, {
      ...row,
      decisionKey,
      conflict: decision?.kind === 'ambiguous' && decision.reason === 'report_conflict',
      position: placed,
      assignment,
      assignmentType,
    });
    if (position === undefined) {
      unfamiliar.push({
        organization: row.organization,
        group: row.group,
        title: row.title,
        vacant: row.occupant === null,
      });
    }
  }

  const plannedRows = rows.map((row) => {
    const plannedRow = planned.get(row);
    if (plannedRow === undefined) throw new Error('import row was not planned');
    return plannedRow;
  });
  let usedExisting = filledExisting;
  for (const count of used.values()) usedExisting += count;

  return {
    decisions: reconciled.decisions,
    absent: reconciled.absent,
    duplicates: reconciled.duplicates,
    inconsistentReports: reconciled.inconsistentReports,
    returning,
    needsCategory,
    unfamiliar,
    keptPositions: Object.keys(input.current.positions).length - usedExisting,
    matchedPositions: usedExisting,
    reportDate: input.bundle.organizations.reportDate,
    fingerprints: {
      organizations: reportFingerprint(input.bundle.organizations),
      'without-callings': reportFingerprint(input.bundle.withoutCallings),
      'out-of-unit': reportFingerprint(input.bundle.outOfUnit),
    },
    currentVersion: input.current.version,
    rows: plannedRows,
    creations,
    ward: input.ward,
    current: input.current,
  };
}
