import { dugout, type AssignmentId, type Board, type Proposal, type TagId, type Ward } from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, Me, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

/* T-088: member and calling tags wired into the integrated board. */

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const fixture = buildFixtureWard();
const current = fixture.current;

const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(frame: string): void {
    this.sent.push(frame);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

type Harness = { client: SyncClient; sockets: FakeSocket[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function opFrames(harness: Harness): { kind: unknown; request: unknown }[] {
  const found: { kind: unknown; request: unknown }[] = [];
  for (const socket of harness.sockets) {
    for (const frame of socket.sent) {
      const parsed = JSON.parse(frame) as unknown;
      if (isRecord(parsed) && parsed.type === 'op' && isRecord(parsed.op)) {
        found.push({ kind: parsed.op.kind, request: parsed.op.request });
      }
    }
  }
  return found;
}

function mount(): Harness {
  const sockets: FakeSocket[] = [];
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function lastSocket(harness: Harness): FakeSocket {
  const socket = harness.sockets[harness.sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function renderShell(harness: Harness): FakeSocket {
  render(
    <SyncProvider client={harness.client}>
      <BoardShell healthClient={pendingHealth} />
    </SyncProvider>,
  );
  act(() => {
    harness.client.start();
    lastSocket(harness).open();
  });
  return lastSocket(harness);
}

function currentInfo(): CurrentInfo {
  return { boardId: current.id, version: current.version, importVersion: 'fixture', importedAt: IMPORTED_AT };
}

function summaryOf(proposal: Proposal): ProposalSummary {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    tabOrder: proposal.tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

function viewOf(proposal: Proposal): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function showSnapshot(socket: FakeSocket, board: Board, ward: Ward, proposal: ProposalView | null): void {
  act(() => {
    socket.receive({ type: 'snapshot', boardId: board.id, version: board.version, board, ward, proposal });
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve();
    }
  });
}

type Opened = { harness: Harness; socket: FakeSocket; user: UserEvent };

/** Opens Current only. */
function openCurrent(ward: Ward): Opened {
  const user = userEvent.setup();
  const harness = mount();
  const socket = renderShell(harness);
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals: [] });
  });
  showSnapshot(socket, current, ward, null);
  return { harness, socket, user };
}

/** Opens Current, then the Draft proposal tab, and loads its baseline. */
async function openProposal(proposal: Proposal, ward: Ward, board: Board = proposal.board): Promise<Opened> {
  const user = userEvent.setup();
  const harness = mount();
  const socket = renderShell(harness);
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals: [summaryOf(proposal)] });
  });
  showSnapshot(socket, current, ward, null);
  await user.click(screen.getByRole('tab', { name: proposal.name }));
  showSnapshot(socket, board, ward, viewOf(proposal));
  // Editing needs the proposal's baseline.
  const getBoard = harness.sockets
    .flatMap((item) => item.sent.map((frame) => JSON.parse(frame) as unknown))
    .filter(isRecord)
    .findLast((frame) => frame.type === 'getBoard');
  if (getBoard === undefined || typeof getBoard.requestId !== 'string') throw new Error('no getBoard request');
  const requestId = getBoard.requestId;
  await act(async () => {
    socket.receive({ type: 'board', requestId, board: proposal.baseline });
    await Promise.resolve();
  });
  await settle();
  return { harness, socket, user };
}

const SUPPORT_GROUP = 'Clerks and Secretaries (support roles)';
const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };

function sentFrames(harness: Harness, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of harness.sockets) {
    for (const frame of socket.sent) {
      const parsed = JSON.parse(frame) as unknown;
      if (isRecord(parsed) && parsed.type === type) found.push(parsed);
    }
  }
  return found;
}

function lastFrame(harness: Harness, type: string): Record<string, unknown> {
  const frame = sentFrames(harness, type).at(-1);
  if (frame === undefined) throw new Error(`no ${type} frame sent`);
  return frame;
}

function requestIdOf(frame: Record<string, unknown>): string {
  if (typeof frame.requestId !== 'string') throw new Error('frame has no requestId');
  return frame.requestId;
}

async function reply(socket: FakeSocket, message: Record<string, unknown>): Promise<void> {
  await act(async () => {
    socket.receive(message);
    await Promise.resolve();
  });
  await settle();
}

async function signIn(harness: Harness, socket: FakeSocket, me: Me): Promise<void> {
  await reply(socket, { type: 'me', requestId: requestIdOf(lastFrame(harness, 'whoami')), user: me });
}

function tagId(ward: Ward, name: string): TagId {
  const found = Object.values(ward.tags).find((tag) => tag.name === name);
  if (found === undefined) throw new Error(`tag ${name} not found`);
  return found.id;
}

function assignmentTitled(board: Board, title: string): AssignmentId {
  const found = Object.values(board.assignments).find((a) => a.title === title);
  if (found === undefined) throw new Error(`assignment ${title} not found`);
  return found.id;
}

/** A dugout member of the board who carries at least one tag. */
function taggedDugoutMember(board: Board, ward: Ward): { id: string; name: string; tagIds: readonly TagId[] } {
  for (const entry of dugout(board, ward)) {
    const member = ward.members[entry.memberId];
    if (member !== undefined && member.tagIds.length > 0) return { id: member.id, name: member.name, tagIds: member.tagIds };
  }
  throw new Error('no tagged dugout member');
}

async function selectDugoutMember(user: UserEvent, name: string): Promise<HTMLElement> {
  const panel = screen.getByRole('complementary', { name: /^Dugout/ });
  const more = within(panel).queryByRole('button', { name: /^Show \d+ more$/ });
  if (more !== null) await user.click(more);
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('article[data-member-id]'));
  const row = rows.find((candidate) => candidate.textContent.includes(name));
  if (row === undefined) throw new Error(`${name} not in the dugout`);
  await user.click(row);
  return screen.getByRole('complementary', { name: `Person: ${name}` });
}

async function openGroup(user: UserEvent, org: string, group: string): Promise<void> {
  await user.dblClick(screen.getByRole('article', { name: org }));
  const row = document.querySelector(`[data-zoom-target^="group:"][aria-label="${group}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`missing group target ${group}`);
  await user.dblClick(row);
}

function acceptedView(proposal: Proposal): ProposalView {
  return { ...viewOf(proposal), status: 'accepted' };
}

async function openAccepted(proposal: Proposal, ward: Ward): Promise<Opened> {
  const user = userEvent.setup();
  const harness = mount();
  const socket = renderShell(harness);
  const accepted: Proposal = { ...proposal, status: 'accepted' };
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals: [summaryOf(accepted)] });
  });
  showSnapshot(socket, current, ward, null);
  await user.click(screen.getByRole('tab', { name: `${proposal.name} Accepted` }));
  showSnapshot(socket, proposal.board, ward, acceptedView(proposal));
  await settle();
  return { harness, socket, user };
}

describe('T-088 member tags', () => {
  it('selecting a person shows their member tags; removing one sends updateMember with the remaining tagIds', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, user } = await openProposal(proposal, fixture.ward);
    const person = taggedDugoutMember(proposal.board, fixture.ward);
    const keep = person.tagIds.slice(1);

    const inspector = await selectDugoutMember(user, person.name);
    expect(screen.getByText('MEMBER TAGS · WARD-WIDE')).toBeInTheDocument();
    expect(within(inspector).getAllByRole('heading', { name: person.name }).length).toBeGreaterThan(0);
    const firstName = fixture.ward.tags[person.tagIds[0] as TagId]?.name ?? '';
    await user.click(screen.getByRole('button', { name: `Remove tag ${firstName}` }));
    await settle();

    const sent = lastFrame(harness, 'updateMember');
    expect(sent.memberId).toBe(person.id);
    expect(sent.patch).toEqual({ tagIds: keep });
  });

  it('the person panel has exactly one heading with the member name', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { user } = await openProposal(proposal, fixture.ward);
    const person = taggedDugoutMember(proposal.board, fixture.ward);
    const inspector = await selectDugoutMember(user, person.name);
    expect(within(inspector).getAllByRole('heading', { level: 2, name: person.name })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Member tags' })).toBeInTheDocument();
  });

  it('Create tag sends createTag then updateMember with the new id', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, socket, user } = await openProposal(proposal, fixture.ward);
    const person = taggedDugoutMember(proposal.board, fixture.ward);
    await selectDugoutMember(user, person.name);

    await user.type(screen.getByRole('combobox', { name: 'Add a tag' }), 'Brand new skill');
    await user.click(screen.getByRole('option', { name: 'Create tag “Brand new skill”' }));
    await settle();
    expect(lastFrame(harness, 'createTag').name).toBe('Brand new skill');
    expect(sentFrames(harness, 'updateMember')).toHaveLength(0);

    await reply(socket, { type: 'tagCreated', requestId: requestIdOf(lastFrame(harness, 'createTag')), tagId: 'tg-new' });
    const update = lastFrame(harness, 'updateMember');
    expect(update.memberId).toBe(person.id);
    expect(update.patch).toEqual({ tagIds: [...person.tagIds, 'tg-new'] });
  });

  it('admin sees the Needs approval switch and it sends setNeedsApproval; editor sees read-only text', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const admin = await openProposal(proposal, fixture.ward);
    const person = taggedDugoutMember(proposal.board, fixture.ward);
    await selectDugoutMember(admin.user, person.name);
    await signIn(admin.harness, admin.socket, ADMIN);

    await admin.user.click(screen.getByRole('switch', { name: /Needs approval/ }));
    await settle();
    const frame = lastFrame(admin.harness, 'setNeedsApproval');
    expect(frame.memberId).toBe(person.id);
    expect(frame.value).toBe(true);
  });

  it('an editor sees Needs approval as read-only text', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const editor = await openProposal(proposal, fixture.ward);
    const person = taggedDugoutMember(proposal.board, fixture.ward);
    await selectDugoutMember(editor.user, person.name);
    await signIn(editor.harness, editor.socket, EDITOR);

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/^Needs approval: (On|Off)$/)).toBeInTheDocument();
    expect(sentFrames(editor.harness, 'setNeedsApproval')).toHaveLength(0);
  });

  it('member tags are editable on Current', async () => {
    const { harness, user } = openCurrent(fixture.ward);
    const person = taggedDugoutMember(current, fixture.ward);
    await selectDugoutMember(user, person.name);

    const firstName = fixture.ward.tags[person.tagIds[0] as TagId]?.name ?? '';
    await user.click(screen.getByRole('button', { name: `Remove tag ${firstName}` }));
    await settle();
    expect(lastFrame(harness, 'updateMember').patch).toEqual({ tagIds: person.tagIds.slice(1) });
  });
});

describe('T-088 calling tags', () => {
  it("level 3 shows Calling tags with the group's callings; changing the select switches the editor", async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { user } = await openProposal(proposal, fixture.ward);
    await openGroup(user, 'Bishopric', SUPPORT_GROUP);

    expect(levelText()).toBe('Group');
    expect(screen.getByRole('heading', { level: 2, name: 'Calling tags' })).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Calling' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Ward Clerk',
      'Executive Secretary',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Ward Clerk' })).toBeInTheDocument();

    await user.selectOptions(select, 'Executive Secretary');
    expect(screen.getByRole('heading', { level: 2, name: 'Executive Secretary' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Ward Clerk' })).toBeNull();
  });

  it('adding a preference sends setCallingPreferences for the selected assignment', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, user } = await openProposal(proposal, fixture.ward);
    await openGroup(user, 'Primary', 'Primary Teachers');
    const teacher = assignmentTitled(proposal.board, 'Primary Teacher');
    const teaches = tagId(fixture.ward, 'Teaches well');
    const musical = tagId(fixture.ward, 'Musical');

    await user.click(screen.getByRole('button', { name: '+ Preference' }));
    await user.type(screen.getByRole('combobox', { name: 'Add a preference' }), 'Musical');
    await user.click(screen.getByRole('option', { name: /^Musical/ }));
    await settle();

    const ops = opFrames(harness).filter((op) => op.kind === 'setCallingPreferences' || op.kind === 'setCallingTags');
    expect(ops).toEqual([
      { kind: 'setCallingPreferences', request: { assignmentId: teacher, tagIds: [teaches, musical] } },
    ]);
  });

  it('adding a calling tag sends setCallingTags for the selected assignment', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, user } = await openProposal(proposal, fixture.ward);
    await openGroup(user, 'Primary', 'Primary Teachers');
    const teacher = assignmentTitled(proposal.board, 'Primary Teacher');

    await user.click(screen.getByRole('button', { name: '+ Tag' }));
    await user.type(screen.getByRole('combobox', { name: 'Add a calling tag' }), 'Musical');
    await user.click(screen.getByRole('option', { name: /^Musical/ }));
    await settle();

    const ops = opFrames(harness).filter((op) => op.kind === 'setCallingPreferences' || op.kind === 'setCallingTags');
    expect(ops).toEqual([
      {
        kind: 'setCallingTags',
        request: { assignmentId: teacher, tagIds: [tagId(fixture.ward, 'Teaches well'), tagId(fixture.ward, 'Musical')] },
      },
    ]);
  });

  it("rejected op shows the editor's alert", async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, socket, user } = await openProposal(proposal, fixture.ward);
    await openGroup(user, 'Primary', 'Primary Teachers');

    await user.click(screen.getByRole('button', { name: '+ Preference' }));
    await user.type(screen.getByRole('combobox', { name: 'Add a preference' }), 'Musical');
    await user.click(screen.getByRole('option', { name: /^Musical/ }));
    await settle();
    await reply(socket, {
      type: 'rejected',
      requestId: requestIdOf(lastFrame(harness, 'op')),
      code: 'invalid',
      message: 'That preference was refused.',
    });

    const panel = screen.getByRole('region', { name: 'Calling tags' });
    expect(within(panel).getByRole('alert')).toHaveTextContent('That preference was refused.');
  });

  it('Current and Accepted render the calling editor read-only', async () => {
    const onCurrent = openCurrent(fixture.ward);
    await openGroup(onCurrent.user, 'Primary', 'Primary Teachers');
    expect(screen.getByRole('heading', { level: 2, name: 'Calling tags' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Primary Teacher' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Preference' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove (calling tag|preference)/ })).toBeNull();
  });

  it('an Accepted proposal renders the calling editor read-only', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { user } = await openAccepted(proposal, fixture.ward);
    await openGroup(user, 'Primary', 'Primary Teachers');
    expect(screen.getByRole('heading', { level: 2, name: 'Primary Teacher' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Preference' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove (calling tag|preference)/ })).toBeNull();
  });

  it('Highlight lists the matching dugout names and clears when the calling changes', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const teaches = tagId(fixture.ward, 'Teaches well');
    const clerk = Object.values(proposal.board.assignments).find((a) => a.title === 'Ward Clerk');
    if (clerk === undefined) throw new Error('no Ward Clerk');
    const board: Board = {
      ...proposal.board,
      assignments: {
        ...proposal.board.assignments,
        [clerk.id]: { ...clerk, preferredMemberTagIds: [teaches] },
      },
    };
    const expected = dugout(board, fixture.ward)
      .map((entry) => fixture.ward.members[entry.memberId])
      .filter((member) => member !== undefined && member.tagIds.includes(teaches))
      .map((member) => member?.name ?? '');
    expect(expected.length).toBeGreaterThan(0);

    const { user } = await openProposal({ ...proposal, board }, fixture.ward, board);
    await openGroup(user, 'Bishopric', SUPPORT_GROUP);
    expect(screen.queryByText(/^Matching:/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Highlight' }));

    const matching = screen.getByText(/^Matching:/);
    expect(matching).toHaveAttribute('role', 'status');
    expect(matching).toHaveTextContent(`Matching: ${expected.join(', ')}`);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Calling' }), 'Executive Secretary');
    expect(screen.queryByText(/^Matching:/)).toBeNull();
  });

  it('a group with no enabled assignments shows no Calling tags panel', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const group = Object.values(proposal.board.callingGroups).find((g) => g.name === SUPPORT_GROUP);
    if (group === undefined) throw new Error('no group');
    const board: Board = {
      ...proposal.board,
      assignments: Object.fromEntries(
        Object.entries(proposal.board.assignments).map(([id, a]) => [id, a.groupId === group.id ? { ...a, enabled: false } : a]),
      ),
    };
    const { user } = await openProposal({ ...proposal, board }, fixture.ward, board);
    await openGroup(user, 'Bishopric', SUPPORT_GROUP);

    expect(levelText()).toBe('Group');
    expect(screen.queryByRole('heading', { level: 2, name: 'Calling tags' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Calling' })).toBeNull();
  });
});

function levelText(): string {
  return document.querySelector('.wb-canvas-level')?.textContent ?? '';
}
