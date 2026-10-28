import {
  proposalDiff,
  removedState,
  rootBoardGroupOf,
  unapprovedPlacements,
  type Board,
  type Proposal,
  type Ward,
} from '@wardboard/core';

export interface PhoneRemovedItemRow {
  readonly key: string;
  readonly kind: 'member' | 'position';
  readonly headline: string; // member: member.name; position: "{org} · {title}"
  readonly detail: string; // member: "Member removed · {titles joined by ', '} here"; position: "Position removed · held by {name}" or "Position removed · vacant here"
}

export interface PhoneChangeRow {
  readonly key: string;
  readonly who: string; // callings/releases: member.name; position changes: 'Added' | 'Trimmed'
  readonly what: string; // "{org} · {title}"
}

export interface PhoneChangesModel {
  readonly proposalName: string;
  readonly status: 'draft' | 'accepted';
  readonly subtitle: string; // "{proposalName} vs. its {MMM D} baseline · net only" (or "{proposalName} · net only" if createdAt is unparseable)
  readonly removedItems: readonly PhoneRemovedItemRow[];
  readonly callings: readonly PhoneChangeRow[];
  readonly releases: readonly PhoneChangeRow[];
  readonly positionChanges: readonly PhoneChangeRow[];
  readonly canAccept: boolean;
  readonly acceptBlockReason: string | null;
}

export function buildPhoneChangesModel(
  proposal: Proposal,
  current: Board,
  ward: Ward,
): PhoneChangesModel {
  // Subtitle
  const parsed = Date.parse(proposal.createdAt);
  let subtitle: string;
  if (Number.isNaN(parsed)) {
    subtitle = `${proposal.name} \u00B7 net only`;
  } else {
    const dateStr = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(parsed));
    subtitle = `${proposal.name} vs. its ${dateStr} baseline \u00B7 net only`;
  }

  // Removed items
  const removed = removedState(proposal, current, ward);
  const removedItems: PhoneRemovedItemRow[] = [];

  for (const entry of removed.members) {
    const member = ward.members[entry.memberId];
    const titles: string[] = [];
    for (const pid of entry.positionIds) {
      const slot = proposal.board.positions[pid];
      if (slot !== undefined) {
        const assignment = proposal.board.assignments[slot.assignmentId];
        if (assignment !== undefined) {
          titles.push(assignment.title);
        }
      }
    }
    const headline = member !== undefined ? member.name : String(entry.memberId);
    const detail = `Member removed \u00B7 ${titles.join(', ')} here`;
    removedItems.push({
      key: `member-${entry.memberId}`,
      kind: 'member',
      headline,
      detail,
    });
  }

  for (const positionId of removed.positions) {
    const slot = proposal.board.positions[positionId];
    if (slot === undefined) {
      continue;
    }
    const assignment = proposal.board.assignments[slot.assignmentId];
    if (assignment === undefined) {
      continue;
    }
    const rootBgId = rootBoardGroupOf(proposal.board, assignment.groupId);
    const org = proposal.board.boardGroups[rootBgId]?.name ?? '';
    const occupantId = proposal.board.placements[positionId];
    const headline = `${org} \u00B7 ${assignment.title}`;
    const detail =
      occupantId !== undefined
        ? `Position removed \u00B7 held by ${ward.members[occupantId]?.name ?? occupantId}`
        : 'Position removed \u00B7 vacant here';
    removedItems.push({
      key: `position-${positionId}`,
      kind: 'position',
      headline,
      detail,
    });
  }

  // Callings and releases
  const diff = proposalDiff(proposal);
  const callings: PhoneChangeRow[] = diff.callings.map((entry) => {
    const member = ward.members[entry.memberId];
    const assignment = proposal.board.assignments[entry.assignmentId];
    if (assignment === undefined) {
      throw new Error(`missing assignment ${entry.assignmentId}`);
    }
    const rootBgId = rootBoardGroupOf(proposal.board, assignment.groupId);
    const org = proposal.board.boardGroups[rootBgId]?.name ?? '';
    return {
      key: `calling-${entry.positionId}-${entry.memberId}`,
      who: member !== undefined ? member.name : String(entry.memberId),
      what: `${org} \u00B7 ${entry.title}`,
    };
  });

  const releases: PhoneChangeRow[] = diff.releases.map((entry) => {
    const member = ward.members[entry.memberId];
    const assignment = proposal.baseline.assignments[entry.assignmentId];
    if (assignment === undefined) {
      throw new Error(`missing assignment ${entry.assignmentId}`);
    }
    const rootBgId = rootBoardGroupOf(proposal.baseline, assignment.groupId);
    const org = proposal.baseline.boardGroups[rootBgId]?.name ?? '';
    return {
      key: `release-${entry.positionId}-${entry.memberId}`,
      who: member !== undefined ? member.name : String(entry.memberId),
      what: `${org} \u00B7 ${entry.title}`,
    };
  });

  // Position changes: added positions followed by trimmed positions
  const addedPositions: PhoneChangeRow[] = diff.addedPositions.map((entry) => {
    const assignment = proposal.board.assignments[entry.assignmentId];
    if (assignment === undefined) {
      throw new Error(`missing assignment ${entry.assignmentId}`);
    }
    const rootBgId = rootBoardGroupOf(proposal.board, assignment.groupId);
    const org = proposal.board.boardGroups[rootBgId]?.name ?? '';
    return {
      key: `added-${entry.positionId}`,
      who: 'Added',
      what: `${org} \u00B7 ${entry.title}`,
    };
  });
  const removedPositions: PhoneChangeRow[] = diff.removedPositions.map((entry) => {
    const assignment = proposal.baseline.assignments[entry.assignmentId];
    if (assignment === undefined) {
      throw new Error(`missing assignment ${entry.assignmentId}`);
    }
    const rootBgId = rootBoardGroupOf(proposal.baseline, assignment.groupId);
    const org = proposal.baseline.boardGroups[rootBgId]?.name ?? '';
    return {
      key: `removed-${entry.positionId}`,
      who: 'Trimmed',
      what: `${org} \u00B7 ${entry.title}`,
    };
  });
  const positionChanges: PhoneChangeRow[] = [...addedPositions, ...removedPositions];

  // Acceptance eligibility
  let canAccept: boolean;
  let acceptBlockReason: string | null;

  if (proposal.status === 'accepted') {
    canAccept = false;
    acceptBlockReason = null;
  } else {
    const removedCount = removedItems.length;
    const unapprovedCount = unapprovedPlacements(proposal, ward).length;

    if (removedCount > 0 && unapprovedCount > 0) {
      canAccept = false;
      acceptBlockReason = `Resolve ${String(removedCount)} removed ${removedCount === 1 ? 'item' : 'items'} and ${String(unapprovedCount)} unapproved ${unapprovedCount === 1 ? 'placement' : 'placements'} to accept`;
    } else if (removedCount > 0) {
      canAccept = false;
      acceptBlockReason =
        removedCount === 1
          ? 'Resolve the 1 removed item to accept'
          : `Resolve the ${String(removedCount)} removed items to accept`;
    } else if (unapprovedCount > 0) {
      canAccept = false;
      acceptBlockReason =
        unapprovedCount === 1
          ? 'Approve 1 placement to accept'
          : `Approve ${String(unapprovedCount)} placements to accept`;
    } else {
      canAccept = true;
      acceptBlockReason = null;
    }
  }

  return {
    proposalName: proposal.name,
    status: proposal.status,
    subtitle,
    removedItems,
    callings,
    releases,
    positionChanges,
    canAccept,
    acceptBlockReason,
  };
}
