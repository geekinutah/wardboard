import type { Board, Proposal, ProposalStatus, SummaryGroup } from '@wardboard/core';

/** `boards.current`. Not exported by the server package; matches `channel.ts`. */
export type CurrentInfo = {
  boardId: Board['id'];
  version: number;
  importVersion: string;
  importedAt: string;
};

/** `snapshot.proposal` and `boards` do not carry this view. Null when the board is not a proposal. */
export type ProposalView = {
  id: Proposal['id'];
  name: string;
  status: ProposalStatus;
  rationale: string | null;
  baselineBoardId: Board['id'];
};

/** Identity returned by `whoami`. The client never asserts it. */
export type Me = {
  login: string;
  displayName: string;
  role: 'editor' | 'admin';
};

/** `showNeedsApproval` from `getSettings` and `settings` pushes. */
export type Settings = {
  showNeedsApproval: boolean;
};

/** Success value or a refusal. These requests never reject and never resolve `null`. */
export type RequestResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string };

/** Fields the server's `parseMemberPatch` accepts. */
export type MemberPatch = {
  name?: string;
  note?: string | null;
  tagIds?: readonly string[];
};

/** Mirrors server access `User`. The web app does not import that module. */
export type AccessUser = {
  id: string;
  login: string;
  displayName: string;
  role: 'editor' | 'admin';
  createdAt: string;
  revokedAt: string | null;
};

/** Mirrors server access `Invitation`. */
export type AccessInvitation = {
  id: string;
  login: string;
  invitedBy: string | null;
  createdAt: string;
};

export type AccessDirectory = {
  users: AccessUser[];
  invitations: AccessInvitation[];
};

/** Mirrors server `ProposalDetail` (`getProposal` → `proposalDetail`). */
export type ProposalDetailView = {
  id: Proposal['id'];
  name: string;
  status: ProposalStatus;
  rationale: string | null;
  baselineBoardId: Board['id'];
  boardId: Board['id'];
  createdAt: string;
  updatedAt: string;
  accepted: { byLogin: string; at: string; summary: SummaryGroup[] } | null;
};

/** `tagUsage` counts: how many records reference a tag. */
export type TagUsage = {
  members: number;
  callingPreferences: number;
  callingTags: number;
};
