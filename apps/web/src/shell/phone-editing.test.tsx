import {
  addListPosition,
  addToDugout,
  addToList,
  boardId as brandBoard,
  callingsOf,
  moveToDugout,
  placeInPosition,
  proposalId,
  releaseCalling,
  sequentialIds,
  type AssignmentId,
  type Board,
  type MemberId,
  type OperationResult,
  type PositionId,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildPreviewData } from '../preview/data.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { PhoneApp } from './PhoneApp.tsx';

/*
 * Fixture (buildPreviewData, Draft "Spring adjustments"):
 * - Bea Placeholder: Primary Teacher (list), no approval needed.
 * - Cy Mockup: Primary Teacher, marked Needs approval.
 * - Hal Testwell: Temple and Family History Consultant, plus one outside calling.
 * - Jay Storybook: in the dugout with no calling.
 * - Vacant: Primary Presidency Secretary (single), Nursery Leader (list),
 *   Music Chorister (single).
 */

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const data = buildPreviewData();
const ward = data.ward;
const draft = data.proposal.board;

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

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const raw of socket.sent) {
      const frame: unknown = JSON.parse(raw);
      if (isRecord(frame) && frame.type === type) found.push(frame);
    }
  }
  return found;
}

type OpFrame = { requestId: string; kind: unknown; request: unknown };

function opFrames(harness: Harness): OpFrame[] {
  return typedFrames(harness.sockets, 'op').map((frame) => {
    const op = isRecord(frame.op) ? frame.op : {};
    return { requestId: typeof frame.requestId === 'string' ? frame.requestId : '', kind: op.kind, request: op.request };
  });
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
    timers: { setTimeout: () => 1, clearTimeout: () => undefined },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function goLive(harness: Harness): FakeSocket {
  act(() => {
    harness.client.start();
    harness.sockets[harness.sockets.length - 1]?.open();
  });
  const socket = harness.sockets[harness.sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function currentInfo(): CurrentInfo {
  return { boardId: data.current.id, version: data.current.version, importVersion: 'fixture', importedAt: IMPORTED_AT };
}

function summary(status: 'draft' | 'accepted'): ProposalSummary {
  return {
    id: proposalId(data.proposal.id),
    name: data.proposal.name,
    status,
    tabOrder: 1,
    boardId: brandBoard(draft.id),
    version: 0,
    updatedAt: IMPORTED_AT,
  };
}

function view(status: 'draft' | 'accepted'): ProposalView {
  return {
    id: data.proposal.id,
    name: data.proposal.name,
    status,
    rationale: data.proposal.rationale,
    baselineBoardId: data.proposal.baseline.id,
  };
}

function showSnapshot(socket: FakeSocket, board: Board, proposal: ProposalView | null): void {
  act(() => {
    socket.receive({ type: 'snapshot', boardId: board.id, version: board.version, board, ward, proposal });
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function receiveBaseline(socket: FakeSocket, sockets: readonly FakeSocket[]): Promise<void> {
  const byId = new Map<string, Board>([
    [data.proposal.baseline.id, data.proposal.baseline],
    [data.current.id, data.current],
  ]);
  await act(async () => {
    for (const frame of typedFrames(sockets, 'getBoard')) {
      const board = typeof frame.boardId === 'string' ? byId.get(frame.boardId) : undefined;
      if (board !== undefined) socket.receive({ type: 'board', requestId: frame.requestId, board });
    }
    await Promise.resolve();
  });
}

async function receiveMe(socket: FakeSocket, sockets: readonly FakeSocket[]): Promise<void> {
  const frame = typedFrames(sockets, 'whoami').at(-1);
  if (frame === undefined) throw new Error('missing whoami');
  await act(async () => {
    socket.receive({
      type: 'me',
      requestId: frame.requestId,
      user: { login: 'ada@example.test', displayName: 'Ada Example', role: 'editor' },
    });
    await Promise.resolve();
  });
}

type Opened = { harness: Harness; socket: FakeSocket; user: UserEvent };

/** Mounts the phone app, signs in, and opens the proposal (or Current when `status` is null). */
async function openBoard(status: 'draft' | 'accepted' | null): Promise<Opened> {
  const user = userEvent.setup();
  const harness = mount();
  render(
    <SyncProvider client={harness.client}>
      <PhoneApp />
    </SyncProvider>,
  );
  const socket = goLive(harness);
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals: [summary(status ?? 'draft')] });
  });
  showSnapshot(socket, data.current, null);
  await receiveMe(socket, harness.sockets);
  if (status !== null) {
    act(() => {
      harness.client.open(draft.id);
    });
    showSnapshot(socket, draft, view(status));
    await receiveBaseline(socket, harness.sockets);
  }
  await settle();
  return { harness, socket, user };
}

const openDraft = (): Promise<Opened> => openBoard('draft');

function expectOk(result: OperationResult): Board {
  if (!result.ok) throw new Error(result.error.message);
  return result.board;
}

function ctx(): { ward: typeof ward; ids: () => string } {
  return { ward, ids: sequentialIds('srv') };
}

function memberNamed(name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) throw new Error(`missing member ${name}`);
  return found.id;
}

function heldPosition(board: Board, member: MemberId): PositionId {
  const first = callingsOf(board, member)[0];
  if (first === undefined) throw new Error(`${member} holds nothing`);
  return first.positionId;
}

function assignmentNamed(board: Board, groupName: string, title: string): AssignmentId {
  const group = Object.values(board.callingGroups).find((item) => item.name === groupName);
  const found = Object.values(board.assignments).find((item) => item.groupId === group?.id && item.title === title);
  if (found === undefined) throw new Error(`missing ${groupName} / ${title}`);
  return found.id;
}

function vacancyIn(board: Board, assignment: AssignmentId): PositionId {
  const found = Object.values(board.positions)
    .filter((position) => position.assignmentId === assignment && board.placements[position.id] === undefined)
    .sort((left, right) => left.order - right.order)[0];
  if (found === undefined) throw new Error(`no vacancy in ${assignment}`);
  return found.id;
}

const BEA = memberNamed('Bea Placeholder');
const CY = memberNamed('Cy Mockup');
const HAL = memberNamed('Hal Testwell');
const JAY = memberNamed('Jay Storybook');
const BEA_TEACHER = heldPosition(draft, BEA);
const CY_TEACHER = heldPosition(draft, CY);
const HAL_CONSULTANT = heldPosition(draft, HAL);
const SECRETARY = vacancyIn(draft, assignmentNamed(draft, 'Primary Presidency', 'Secretary'));
const NURSERY = assignmentNamed(draft, 'Nursery', 'Nursery Leader');
const CHORISTER = vacancyIn(draft, assignmentNamed(draft, 'Music', 'Chorister'));

/** The server's broadcast of `board` as the next version, answering `requestId`. */
function commit(socket: FakeSocket, requestId: string, board: Board, version: number): void {
  act(() => {
    socket.receive({ type: 'committed', boardId: board.id, version, board: { ...board, version }, requestId, by: 'e2e@example.test' });
  });
}

async function openOrg(user: UserEvent, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
}

async function openPerson(user: UserEvent, org: string, row: string): Promise<HTMLElement> {
  await openOrg(user, org);
  await user.click(screen.getByRole('button', { name: row }));
  return screen.getByRole('dialog', { name: new RegExp(`^${row.split(',')[0] ?? ''}`) });
}

function changeAlert(): HTMLElement | undefined {
  return screen.queryAllByRole('alert').find((node) => node.textContent.includes("Couldn't apply the change"));
}

async function approve(user: UserEvent): Promise<void> {
  const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Approve placement' }));
}

describe('phone board editing', () => {
  it('tapping a person opens the person sheet for the open board', async () => {
    const { user } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    expect(sheet).toHaveTextContent(`Callings in ${data.proposal.name}`);
    expect(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Release from Primary Teacher' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Add to dugout/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Profile, note & photo' })).not.toBeInTheDocument();
  });

  it('Current shows the person sheet read-only', async () => {
    const { user, harness } = await openBoard(null);
    await openOrg(user, 'Primary');
    expect(screen.queryByRole('button', { name: /Add (a )?position/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }));
    const sheet = screen.getByRole('dialog', { name: /^Bea Placeholder/ });
    expect(sheet).toHaveTextContent('Callings in Current');
    expect(sheet).toHaveTextContent('Primary Teacher');
    for (const name of [/^Move/, /^Release/, /Add to dugout/, /Profile, note & photo/]) {
      expect(within(sheet).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(opFrames(harness)).toHaveLength(0);
  });

  it('an accepted proposal shows the sheet read-only', async () => {
    const { user } = await openBoard('accepted');
    await openOrg(user, 'Primary');
    expect(screen.queryByRole('button', { name: /Add (a )?position/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Vacant,/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }));
    const sheet = screen.getByRole('dialog', { name: /^Bea Placeholder/ });
    expect(sheet).toHaveTextContent(`Callings in ${data.proposal.name}`);
    expect(sheet).toHaveTextContent('Primary Teacher');
    for (const name of [/^Move/, /^Release/, /Add to dugout/, /Profile, note & photo/]) {
      expect(within(sheet).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('move to a vacant single position sends placeInPosition', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    const move = screen.getByRole('dialog', { name: 'Move Bea Placeholder' });
    await user.click(within(move).getByRole('button', { name: 'Secretary, Primary · Primary Presidency' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'placeInPosition',
      request: { memberId: BEA, from: BEA_TEACHER, to: SECRETARY },
    });
    const after = expectOk(placeInPosition(draft, ctx(), { memberId: BEA, from: BEA_TEACHER, to: SECRETARY }));
    commit(socket, frames[0]?.requestId ?? '', after, draft.version + 1);
    await settle();

    expect(screen.queryByRole('dialog', { name: 'Move Bea Placeholder' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Moved Bea Placeholder')).toBe(true);
    expect(screen.getByRole('button', { name: 'Bea Placeholder, Secretary' })).toBeInTheDocument();
  });

  it('move to a list destination sends addToList', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    await user.click(screen.getByRole('button', { name: 'Nursery Leader, Primary · Nursery' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('addToList');
    expect(frames[0]?.request).toEqual({ memberId: BEA, from: BEA_TEACHER, assignmentId: NURSERY });
    const after = expectOk(addToList(draft, ctx(), { memberId: BEA, from: BEA_TEACHER, assignmentId: NURSERY }));
    commit(socket, frames[0]?.requestId ?? '', after, draft.version + 1);
    await settle();
    expect(screen.getByText('Moved Bea Placeholder')).toBeInTheDocument();
  });

  it('Release sends releaseCalling', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Release from Primary Teacher' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('releaseCalling');
    expect(frames[0]?.request).toEqual({ memberId: BEA, positionId: BEA_TEACHER });
    const after = expectOk(releaseCalling(draft, ctx(), { memberId: BEA, positionId: BEA_TEACHER }));
    commit(socket, frames[0]?.requestId ?? '', after, draft.version + 1);
    await settle();
    expect(screen.queryByRole('dialog', { name: /^Bea Placeholder/ })).not.toBeInTheDocument();
    expect(screen.getByText('Released Bea Placeholder')).toBeInTheDocument();
  });

  it('Add to dugout keeps the sheet open and flips to In dugout', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: /Add to dugout/ }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('addToDugout');
    expect(frames[0]?.request).toEqual({ memberId: BEA });
    expect(within(sheet).queryByText('In dugout')).not.toBeInTheDocument();

    const after = expectOk(addToDugout(draft, ctx(), { memberId: BEA }));
    commit(socket, frames[0]?.requestId ?? '', after, draft.version + 1);
    await settle();
    const open = screen.getByRole('dialog', { name: /^Bea Placeholder/ });
    expect(within(open).getByText('In dugout')).toBeInTheDocument();
    expect(within(open).queryByRole('button', { name: /Add to dugout/ })).not.toBeInTheDocument();
    expect(screen.getByText('Added Bea Placeholder to dugout')).toBeInTheDocument();
  });

  it('Send to dugout sends moveToDugout', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Move Bea Placeholder' })).getByRole('button', { name: 'Send to dugout' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('moveToDugout');
    expect(frames[0]?.request).toEqual({ memberId: BEA, from: BEA_TEACHER });
    const after = expectOk(moveToDugout(draft, ctx(), { memberId: BEA, from: BEA_TEACHER }));
    commit(socket, frames[0]?.requestId ?? '', after, draft.version + 1);
    await settle();
    expect(screen.queryByRole('dialog', { name: 'Move Bea Placeholder' })).not.toBeInTheDocument();
    expect(screen.getByText('Sent Bea Placeholder to dugout')).toBeInTheDocument();
  });

  it('Assign calling places a member without a calling', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    // Another client releases Bea while her sheet is open.
    const released = expectOk(releaseCalling(draft, ctx(), { memberId: BEA, positionId: BEA_TEACHER }));
    commit(socket, 'other-client', released, draft.version + 1);
    await settle();
    expect(sheet).toHaveTextContent('No callings in this proposal.');

    await user.click(within(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).getByRole('button', { name: 'Assign calling…' }));
    const move = screen.getByRole('dialog', { name: 'Move Bea Placeholder' });
    expect(move).toHaveTextContent('Tap a vacant calling to place Bea Placeholder.');
    expect(within(move).queryByRole('button', { name: 'Send to dugout' })).not.toBeInTheDocument();
    await user.click(within(move).getByRole('button', { name: 'Secretary, Primary · Primary Presidency' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('placeInPosition');
    expect(frames[0]?.request).toEqual({ memberId: BEA, from: null, to: SECRETARY });
    const placed = expectOk(placeInPosition(released, ctx(), { memberId: BEA, from: null, to: SECRETARY }));
    commit(socket, frames[0]?.requestId ?? '', placed, draft.version + 2);
    await settle();
    expect(screen.getByText('Placed Bea Placeholder')).toBeInTheDocument();
  });

  /** Hal keeps an outside calling; another client releases his ward calling while his sheet is open. */
  async function assignHal(): Promise<Opened & { released: Board }> {
    const opened = await openDraft();
    await openPerson(opened.user, 'Ward-wide Callings', 'Hal Testwell, Temple and Family History Consultant');
    const released = expectOk(releaseCalling(draft, ctx(), { memberId: HAL, positionId: HAL_CONSULTANT }));
    commit(opened.socket, 'other-client', released, draft.version + 1);
    await settle();
    await opened.user.click(screen.getByRole('button', { name: 'Assign calling…' }));
    await opened.user.click(screen.getByRole('button', { name: 'Chorister, Ward-wide Callings · Music' }));
    return { ...opened, released };
  }

  it('a move that adds a second calling asks first', async () => {
    const { user, harness, socket, released } = await assignHal();
    const dialog = screen.getByRole('dialog', { name: 'Give Hal Testwell a second calling?' });
    expect(dialog).toHaveTextContent(/Serves outside the ward as/);
    expect(dialog).toHaveTextContent('Adding Music · Chorister');
    expect(screen.queryByRole('dialog', { name: 'Move Hal Testwell' })).not.toBeInTheDocument();
    expect(opFrames(harness)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Add second calling' }));
    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('placeInPosition');
    expect(frames[0]?.request).toEqual({ memberId: HAL, from: null, to: CHORISTER });
    const placed = expectOk(placeInPosition(released, ctx(), { memberId: HAL, from: null, to: CHORISTER }));
    commit(socket, frames[0]?.requestId ?? '', placed, draft.version + 2);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Placed Hal Testwell')).toBeInTheDocument();
  });

  it('cancelling the second-calling dialog sends nothing', async () => {
    const { user, harness } = await assignHal();
    const dialog = screen.getByRole('dialog', { name: 'Give Hal Testwell a second calling?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(opFrames(harness)).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Give Hal Testwell a second calling?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Move Hal Testwell' })).toBeInTheDocument();
  });

  it('a needs-approval move sends the approval after the placement', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Cy Mockup, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    await user.click(screen.getByRole('button', { name: 'Secretary, Primary · Primary Presidency' }));

    const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
    expect(dialog).toHaveTextContent('Cy Mockup is marked Needs approval.');
    expect(dialog).toHaveTextContent('Primary Presidency · Secretary');
    expect(dialog).toHaveTextContent(data.proposal.name);
    expect(dialog).toHaveTextContent('Recorded as Ada Example');
    expect(opFrames(harness)).toHaveLength(0);
    await approve(user);

    let frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('placeInPosition');
    expect(frames[0]?.request).toEqual({ memberId: CY, from: CY_TEACHER, to: SECRETARY });
    const placed = expectOk(placeInPosition(draft, ctx(), { memberId: CY, from: CY_TEACHER, to: SECRETARY }));
    commit(socket, frames[0]?.requestId ?? '', placed, draft.version + 1);
    await settle();

    frames = opFrames(harness);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.kind).toBe('approvePlacement');
    expect(frames[1]?.request).toEqual({ memberId: CY, positionId: SECRETARY });
    const approved: Board = {
      ...placed,
      approvals: [...placed.approvals, { memberId: CY, positionId: SECRETARY, approvedBy: 'ada@example.test' as Board['approvals'][number]['approvedBy'], approvedAt: IMPORTED_AT }],
    };
    commit(socket, frames[1]?.requestId ?? '', approved, draft.version + 2);
    await settle();
    expect(screen.getByText('Moved Cy Mockup')).toBeInTheDocument();
    expect(changeAlert()).toBeUndefined();
  });

  it('a list approval names the position the server filled', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Cy Mockup, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    await user.click(screen.getByRole('button', { name: 'Nursery Leader, Primary · Nursery' }));
    await approve(user);

    let frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.request).toEqual({ memberId: CY, from: CY_TEACHER, assignmentId: NURSERY });

    // The server added a new Nursery Leader seat for Cy instead of the vacancy preflight saw.
    const guessed = vacancyIn(draft, NURSERY);
    const grown = expectOk(addListPosition(draft, ctx(), { assignmentId: NURSERY }));
    const seat = Object.keys(grown.positions).find((id) => draft.positions[id as PositionId] === undefined) as PositionId;
    expect(seat).not.toBe(guessed);
    const placements = Object.fromEntries(
      [...Object.entries(grown.placements), [seat, CY]].filter(([position]) => position !== CY_TEACHER),
    ) as Board['placements'];
    const committed: Board = { ...grown, placements };
    commit(socket, frames[0]?.requestId ?? '', committed, draft.version + 1);
    await settle();

    frames = opFrames(harness);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.kind).toBe('approvePlacement');
    expect(frames[1]?.request).toEqual({ memberId: CY, positionId: seat });
  });

  it("a list approval that can't find the saved position says so", async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Cy Mockup, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    await user.click(screen.getByRole('button', { name: 'Nursery Leader, Primary · Nursery' }));
    await approve(user);
    const frames = opFrames(harness);
    // A board where Cy never reached the list.
    commit(socket, frames[0]?.requestId ?? '', draft, draft.version + 1);
    await settle();
    expect(opFrames(harness)).toHaveLength(1);
    expect(changeAlert()).toHaveTextContent(
      "Couldn't apply the change: the new position for this approval wasn't found on the saved board",
    );
  });

  it('a refused operation shows the reason and keeps the sheet', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Release from Primary Teacher' }));
    const frames = opFrames(harness);
    act(() => {
      socket.receive({ type: 'rejected', requestId: frames[0]?.requestId, code: 'conflict', message: 'stale board' });
    });
    await settle();

    const alert = changeAlert();
    expect(alert).toHaveTextContent("Couldn't apply the change: stale board");
    expect(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).toBeInTheDocument();
    expect(screen.queryByText('Released Bea Placeholder')).not.toBeInTheDocument();
    if (alert === undefined) throw new Error('missing alert');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(changeAlert()).toBeUndefined();
    // The sheet works again after a refusal.
    expect(within(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).getByRole('button', { name: 'Release from Primary Teacher' })).toBeEnabled();
  });

  it('an offline refusal shows no alert', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    // The socket stops being writable; the client refuses the op as offline.
    socket.readyState = 0;
    await user.click(within(sheet).getByRole('button', { name: 'Release from Primary Teacher' }));
    await settle();
    expect(opFrames(harness)).toHaveLength(0);
    expect(changeAlert()).toBeUndefined();
    expect(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).toBeInTheDocument();
  });

  it('a second tap while sending sends once', async () => {
    const { user, harness } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: 'Move from Primary Teacher' }));
    const destination = screen.getByRole('button', { name: 'Secretary, Primary · Primary Presidency' });
    act(() => {
      destination.click();
      destination.click();
    });
    await settle();
    expect(opFrames(harness)).toHaveLength(1);
    // While the op is in flight, the sheet's actions are disabled.
    const move = screen.getByRole('dialog', { name: 'Move Bea Placeholder' });
    expect(within(move).getByRole('button', { name: 'Secretary, Primary · Primary Presidency' })).toBeDisabled();
    expect(within(move).getByRole('button', { name: 'Send to dugout' })).toBeDisabled();
    await user.click(within(move).getByRole('button', { name: 'Send to dugout' }));
    expect(opFrames(harness)).toHaveLength(1);
  });

  it('tapping a vacancy opens the fill sheet and places a dugout member', async () => {
    const { user, harness, socket } = await openDraft();
    await openOrg(user, 'Ward-wide Callings');
    await user.click(screen.getByRole('button', { name: 'Vacant, Chorister' }));
    const fill = screen.getByRole('dialog', { name: 'Fill Chorister' });
    expect(fill).toHaveTextContent('Ward-wide Callings · Music');
    expect(within(fill).getByRole('button', { name: 'Ari Sample, No calling' })).toBeInTheDocument();
    expect(within(fill).getByRole('button', { name: 'Tai Demo, No calling, Matches Musical' })).toBeInTheDocument();
    await user.click(within(fill).getByRole('button', { name: 'Jay Storybook, No calling' }));

    const frames = opFrames(harness);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('placeInPosition');
    expect(frames[0]?.request).toEqual({ memberId: JAY, from: null, to: CHORISTER });
    const placed = expectOk(placeInPosition(draft, ctx(), { memberId: JAY, from: null, to: CHORISTER }));
    commit(socket, frames[0]?.requestId ?? '', placed, draft.version + 1);
    await settle();
    expect(screen.queryByRole('dialog', { name: 'Fill Chorister' })).not.toBeInTheDocument();
    expect(screen.getByText('Placed Jay Storybook')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jay Storybook, Chorister' })).toBeInTheDocument();
  });

  it('filling from the dugout with someone who keeps a calling asks first', async () => {
    const { user, harness, socket } = await openDraft();
    const sheet = await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(within(sheet).getByRole('button', { name: /Add to dugout/ }));
    const inDugout = expectOk(addToDugout(draft, ctx(), { memberId: BEA }));
    commit(socket, opFrames(harness)[0]?.requestId ?? '', inDugout, draft.version + 1);
    await settle();
    await user.click(within(screen.getByRole('dialog', { name: /^Bea Placeholder/ })).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Vacant, Secretary' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Fill Secretary' })).getByRole('button', { name: 'Bea Placeholder, Primary Teacher' }));
    const dialog = screen.getByRole('dialog', { name: 'Give Bea Placeholder a second calling?' });
    expect(dialog).toHaveTextContent('Already serves as Primary Teacher');
    expect(opFrames(harness)).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Fill Secretary' })).toBeInTheDocument();
    expect(opFrames(harness)).toHaveLength(1);
  });

  it('switching boards closes an open sheet', async () => {
    const { user } = await openDraft();
    await openPerson(user, 'Primary', 'Bea Placeholder, Primary Teacher');
    await user.click(screen.getByRole('button', { name: /Switch board/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Boards' })).getByRole('button', { name: /^Current/ }));
    expect(screen.queryByRole('dialog', { name: /^Bea Placeholder/ })).not.toBeInTheDocument();
  });
});
