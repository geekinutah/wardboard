import {
  addToDugout,
  createWard,
  sequentialIds,
  type Board,
  type MemberId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import type { ProposalSummary } from '@wardboard/server';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

/* T-083: the Out-of-Unit tile, view and drags on the integrated board. */

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

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) throw new Error(`member ${name} not found`);
  return found.id;
}

function levelText(): string {
  return document.querySelector('.wb-canvas-level')?.textContent ?? '';
}

function dugoutPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: /^Dugout/ });
}

function kaiCard(ward: Ward): HTMLElement {
  const card = document.querySelector<HTMLElement>(`article[data-member-id="${memberNamed(ward, 'Kai Fictional')}"]`);
  if (card === null) throw new Error('Kai card not rendered');
  return card;
}

let underPointer: Element | null = null;

beforeEach(() => {
  underPointer = null;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => underPointer });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
});

function drag(from: Element, to: Element): void {
  fireEvent.pointerDown(from, { clientX: 100, clientY: 100, button: 0, pointerId: 1, pointerType: 'mouse' });
  underPointer = to;
  fireEvent.pointerMove(to, { clientX: 140, clientY: 160, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(to, { clientX: 140, clientY: 160, pointerId: 1, pointerType: 'mouse' });
}

function withoutOutsideCallings(ward: Ward): Ward {
  const result = createWard({
    members: Object.fromEntries(Object.entries(ward.members).map(([id, member]) => [id, { ...member, externalCallings: [] }])),
    tags: ward.tags,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe('T-083 Out-of-Unit on the board', () => {
  it('overview shows the Out-of-Unit tile after the organizations', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    await openProposal(proposal, fixture.ward);

    const tile = screen.getByRole('article', { name: 'Out-of-Unit' });
    expect(tile).toHaveTextContent('2 members serving outside the ward');
    const orgs = screen.getAllByRole('article').filter((node) => node !== tile && node.closest('[data-zoom-target^="org:"]'));
    expect(orgs.length).toBeGreaterThan(0);
    for (const org of orgs) {
      expect(org.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(tile.closest('[data-zoom-target="org:out-of-unit"]')).not.toBeNull();
  });

  it('no tile when no one serves outside the ward', async () => {
    const ward = withoutOutsideCallings(fixture.ward);
    const proposal = buildFixtureProposal(current, ward);
    await openProposal(proposal, ward);

    expect(screen.queryByRole('article', { name: 'Out-of-Unit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Out-of-Unit' })).toBeNull();
  });

  it('double-click and Open Out-of-Unit show the view', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { user } = await openProposal(proposal, fixture.ward);

    await user.dblClick(screen.getByRole('article', { name: 'Out-of-Unit' }));
    expect(levelText()).toBe('Organization');
    expect(screen.getByRole('heading', { level: 2, name: 'Out-of-Unit' })).toBeInTheDocument();
    expect(kaiCard(fixture.ward)).toHaveTextContent('Kai Fictional');

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(levelText()).toBe('Ward');
    await user.click(screen.getByRole('button', { name: 'Open Out-of-Unit' }));
    expect(levelText()).toBe('Organization');
    expect(screen.getByRole('heading', { level: 2, name: 'Out-of-Unit' })).toBeInTheDocument();
  });

  it('dragging Kai into a vacancy asks for a second calling and sends addToList', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, socket, user } = await openProposal(proposal, fixture.ward);
    const kai = memberNamed(fixture.ward, 'Kai Fictional');

    // Add Kai to the dugout from the view; the server answers with the new board.
    await user.dblClick(screen.getByRole('article', { name: 'Out-of-Unit' }));
    await user.click(within(kaiCard(fixture.ward)).getByRole('button', { name: 'Add to dugout' }));
    await settle();
    expect(opFrames(harness)).toEqual([{ kind: 'addToDugout', request: { memberId: kai } }]);
    const added = addToDugout(proposal.board, { ward: fixture.ward, ids: sequentialIds('srv') }, { memberId: kai });
    if (!added.ok) throw new Error(added.error.message);
    showSnapshot(socket, { ...added.board, version: proposal.board.version + 1 }, fixture.ward, viewOf(proposal));

    // Carry him from the dugout to a vacancy in Relief Society Teachers.
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.dblClick(screen.getByRole('article', { name: 'Relief Society' }));
    const row = document.querySelector('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]');
    if (!(row instanceof HTMLElement)) throw new Error('missing Relief Society Teachers target');
    await user.dblClick(row);
    const group = Object.values(proposal.board.callingGroups).find((g) => g.name === 'Relief Society Teachers');
    const assignment = Object.values(proposal.board.assignments).find((a) => a.groupId === group?.id && a.title === 'Relief Society Teacher');
    const vacancy = Object.values(proposal.board.positions)
      .filter((p) => p.assignmentId === assignment?.id)
      .find((p) => proposal.board.placements[p.id] === undefined);
    if (vacancy === undefined) throw new Error('no vacancy');
    const slot = document.querySelector<HTMLElement>(`[data-position-id="${vacancy.id}"]`);
    if (slot === null) throw new Error('vacancy not rendered');
    const dugoutRow = dugoutPanel().querySelector<HTMLElement>(`article[data-member-id="${kai}"]`);
    if (dugoutRow === null) throw new Error('Kai is not in the dugout');
    drag(dugoutRow, slot);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Give Kai Fictional a second calling\?/);
    expect(dialog).toHaveTextContent('Stake Young Single Adult Adviser');
    await user.click(within(dialog).getByRole('button', { name: 'Add second calling' }));
    await settle();

    const frames = opFrames(harness);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.kind).toBe('addToList');
    expect(frames[1]?.request).toMatchObject({ memberId: kai, from: null, assignmentId: assignment?.id });
  });

  it('dragging Kai to the dugout sends addToDugout with no dialog', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { harness, user } = await openProposal(proposal, fixture.ward);
    const kai = memberNamed(fixture.ward, 'Kai Fictional');

    await user.dblClick(screen.getByRole('article', { name: 'Out-of-Unit' }));
    drag(kaiCard(fixture.ward), dugoutPanel());
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opFrames(harness)).toEqual([{ kind: 'addToDugout', request: { memberId: kai } }]);
  });

  it('Current: no Add to dugout and no drag', async () => {
    const { harness, user } = openCurrent(fixture.ward);
    await user.dblClick(screen.getByRole('article', { name: 'Out-of-Unit' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Out-of-Unit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).toBeNull();
    drag(kaiCard(fixture.ward), dugoutPanel());
    await settle();
    expect(opFrames(harness)).toEqual([]);
  });
});
