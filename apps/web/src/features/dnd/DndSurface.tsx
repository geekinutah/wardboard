import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { memberId as toMemberId, positionId as toPositionId, type Board, type Proposal, type Ward } from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { avatarColor, initials } from '../../design/person.ts';
import { ApprovalDialog, DropDialog, SecondCallingDialog, type ApprovalEntry, type DropChoice } from './dialogs.tsx';
import { destinationLabel, memberName, positionLabel } from './labels.ts';
import { dropContext, preflight, resolveDrop, runDropOp, type Preflight } from './resolve.ts';
import type { DragSource, DropOp, DropTarget } from './types.ts';
import './dnd.css';

/** A drag starts only after the pointer moves more than this many CSS pixels. */
export const DRAG_THRESHOLD_PX = 6;
const DEFAULT_HOVER_OPEN_DELAY_MS = 700;
const DRAGGING_ROOT_CLASS = 'wb-dnd-dragging';

export interface DndSurfaceProps {
  readonly board: Board;
  readonly ward: Ward;
  /** The proposal being edited, or null on Current. */
  readonly proposal: Proposal | null;
  readonly me: { readonly displayName: string };
  /** Current (and any read-only board): no drag ever starts. */
  readonly readOnly: boolean;
  /** Called once per completed drop with the operation, then any approvals. Never on cancel. */
  readonly onCommit: (ops: readonly DropOp[]) => void;
  /** The `data-zoom-target` value hovered while dragging for `hoverOpenDelayMs`. */
  readonly onHoverOpen: (target: string) => void;
  readonly hoverOpenDelayMs?: number;
  readonly children: ReactNode;
}

interface Press {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly source: DragSource;
  readonly sourceEl: Element;
  started: boolean;
}

interface Hover {
  readonly el: Element;
  readonly target: DropTarget;
  readonly valid: boolean;
}

interface Ghost {
  readonly name: string;
  readonly from: string | null;
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Flow =
  | { readonly stage: 'choose'; readonly options: readonly DropChoice[] }
  | { readonly stage: 'second'; readonly op: DropOp; readonly pre: Preflight }
  | { readonly stage: 'approval'; readonly op: DropOp; readonly entries: readonly ApprovalEntry[] };

function within(surface: HTMLElement, el: Element | null): el is Element {
  return el !== null && surface.contains(el);
}

function boxOf(el: Element): Box {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** The drag source for a pointerdown target, or null when nothing draggable was pressed. */
function sourceAt(surface: HTMLElement, start: Element): { source: DragSource; el: Element } | null {
  const el = start.closest('[data-member-id]');
  if (!within(surface, el)) {
    return null;
  }
  const member = el.getAttribute('data-member-id');
  if (member === null || member === '') {
    return null;
  }
  const memberId = toMemberId(member);
  const position = el.getAttribute('data-position-id');
  if (position !== null && position !== '') {
    return { source: { kind: 'position', memberId, positionId: toPositionId(position) }, el };
  }
  if (within(surface, el.closest('[data-drop-target="dugout"]'))) {
    return { source: { kind: 'dugout', memberId }, el };
  }
  return { source: { kind: 'member', memberId }, el };
}

/** The drop target under an element: the nearest position card, else the dugout. */
function targetAt(surface: HTMLElement, under: Element | null): { el: Element; target: DropTarget } | null {
  if (!within(surface, under)) {
    return null;
  }
  const position = under.closest('[data-position-id]');
  if (within(surface, position)) {
    const id = position.getAttribute('data-position-id');
    if (id !== null && id !== '') {
      return { el: position, target: { kind: 'position', positionId: toPositionId(id) } };
    }
  }
  const dugout = under.closest('[data-drop-target="dugout"]');
  if (within(surface, dugout)) {
    return { el: dugout, target: { kind: 'dugout' } };
  }
  return null;
}

function zoomTargetAt(surface: HTMLElement, under: Element | null): string | null {
  if (!within(surface, under)) {
    return null;
  }
  const el = under.closest('[data-zoom-target]');
  if (!within(surface, el)) {
    return null;
  }
  return el.getAttribute('data-zoom-target');
}

function approvalOps(entries: readonly ApprovalEntry[]): DropOp[] {
  return entries.map((entry) => ({
    kind: 'approvePlacement',
    request: { memberId: entry.memberId, positionId: entry.positionId },
  }));
}

/**
 * Wraps board views and turns pointer drags of member cards into core
 * operations, after any required dialog. Reads only the data attributes the
 * views already render; never changes them except `data-drop-active` and
 * `data-dragging` while a drag is in progress.
 */
export function DndSurface(props: DndSurfaceProps): ReactElement {
  const { board, ward, proposal, me, readOnly, children } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const pressRef = useRef<Press | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const zoomRef = useRef<{ value: string | null; timer: ReturnType<typeof setTimeout> | null }>({ value: null, timer: null });
  const detachRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [highlight, setHighlight] = useState<Box | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(
    () => () => {
      detachRef.current?.();
      document.documentElement.classList.remove(DRAGGING_ROOT_CLASS);
    },
    [],
  );

  function clearZoom(): void {
    const zoom = zoomRef.current;
    if (zoom.timer !== null) {
      clearTimeout(zoom.timer);
    }
    zoomRef.current = { value: null, timer: null };
  }

  function endDrag(): void {
    detachRef.current?.();
    detachRef.current = null;
    clearZoom();
    hoverRef.current?.el.removeAttribute('data-drop-active');
    hoverRef.current = null;
    pressRef.current?.sourceEl.removeAttribute('data-dragging');
    pressRef.current = null;
    document.documentElement.classList.remove(DRAGGING_ROOT_CLASS);
    setGhost(null);
    setHighlight(null);
  }

  function suppressNextClick(): void {
    suppressClickRef.current = true;
    // The click that follows pointerup is dispatched before this timer runs.
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function updateTarget(surface: HTMLElement, x: number, y: number): void {
    const under = document.elementFromPoint(x, y);
    const found = targetAt(surface, under);
    const previous = hoverRef.current;
    if (found?.el !== previous?.el) {
      previous?.el.removeAttribute('data-drop-active');
      const press = pressRef.current;
      if (found === null || press === null) {
        hoverRef.current = null;
      } else {
        const plan = resolveDrop(latest.current.board, latest.current.ward, press.source, found.target);
        const valid = plan.kind !== 'none';
        if (valid) {
          found.el.setAttribute('data-drop-active', 'true');
        }
        hoverRef.current = { el: found.el, target: found.target, valid };
      }
    }
    const hover = hoverRef.current;
    setHighlight(hover !== null && hover.valid ? boxOf(hover.el) : null);

    const value = zoomTargetAt(surface, under);
    if (value !== zoomRef.current.value) {
      clearZoom();
      if (value !== null) {
        const timer = setTimeout(() => {
          zoomRef.current = { value, timer: null };
          latest.current.onHoverOpen(value);
        }, latest.current.hoverOpenDelayMs ?? DEFAULT_HOVER_OPEN_DELAY_MS);
        zoomRef.current = { value, timer };
      }
    }
  }

  function startDrag(press: Press): void {
    press.started = true;
    setAlert(null);
    press.sourceEl.setAttribute('data-dragging', 'true');
    document.documentElement.classList.add(DRAGGING_ROOT_CLASS);
    window.getSelection()?.removeAllRanges();
  }

  function commit(op: DropOp, approvals: readonly ApprovalEntry[]): void {
    setFlow(null);
    latest.current.onCommit([op, ...approvalOps(approvals)]);
  }

  function approvalEntries(op: DropOp, pre: Preflight): ApprovalEntry[] {
    const current = latest.current;
    let labelsFrom = current.board;
    if (op.kind !== 'approvePlacement') {
      const after = runDropOp(current.board, dropContext(current.board, current.ward), op);
      if (after.ok) {
        labelsFrom = after.board;
      }
    }
    return pre.approvals.map((approval) => ({
      memberId: approval.memberId,
      positionId: approval.positionId,
      name: memberName(current.ward, approval.memberId),
      calling: positionLabel(labelsFrom, approval.positionId),
    }));
  }

  function afterSecondCalling(op: DropOp, pre: Preflight): void {
    if (pre.approvals.length > 0) {
      setFlow({ stage: 'approval', op, entries: approvalEntries(op, pre) });
      return;
    }
    commit(op, []);
  }

  function proceed(op: DropOp): void {
    const current = latest.current;
    const pre = preflight(current.proposal, current.board, current.ward, op);
    if (pre.secondCalling !== null) {
      setFlow({ stage: 'second', op, pre });
      return;
    }
    afterSecondCalling(op, pre);
  }

  function drop(source: DragSource, target: DropTarget): void {
    const plan = resolveDrop(latest.current.board, latest.current.ward, source, target);
    switch (plan.kind) {
      case 'none':
        return;
      case 'blocked':
        setAlert(plan.message);
        return;
      case 'choose':
        setFlow({ stage: 'choose', options: plan.options });
        return;
      case 'apply':
        proceed(plan.op);
        return;
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const surface = surfaceRef.current;
    if (readOnly || flow !== null || pressRef.current !== null || surface === null || event.button !== 0) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    const found = sourceAt(surface, event.target);
    if (found === null) {
      return;
    }
    suppressClickRef.current = false;
    const press: Press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: found.source,
      sourceEl: found.el,
      started: false,
    };
    pressRef.current = press;

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== press.pointerId || pressRef.current !== press) return;
      if (!press.started) {
        if (Math.hypot(ev.clientX - press.startX, ev.clientY - press.startY) <= DRAG_THRESHOLD_PX) return;
        startDrag(press);
      }
      ev.preventDefault();
      const current = latest.current;
      const from = press.source.kind === 'position' ? positionLabel(current.board, press.source.positionId).title : null;
      setGhost({ name: memberName(current.ward, press.source.memberId), from, x: ev.clientX, y: ev.clientY });
      updateTarget(surface, ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== press.pointerId || pressRef.current !== press) return;
      if (!press.started) {
        endDrag();
        return;
      }
      updateTarget(surface, ev.clientX, ev.clientY);
      const hover = hoverRef.current;
      suppressNextClick();
      endDrag();
      if (hover !== null) {
        drop(press.source, hover.target);
      }
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId !== press.pointerId || pressRef.current !== press) return;
      if (press.started) suppressNextClick();
      endDrag();
    };
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || pressRef.current !== press || !press.started) return;
      ev.preventDefault();
      suppressNextClick();
      endDrag();
    };
    const onSelectStart = (ev: Event): void => {
      ev.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('selectstart', onSelectStart);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>): void {
    if (!suppressClickRef.current) return;
    if (event.target instanceof Element && event.target.closest('.wb-dnd-layer') !== null) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function cancelFlow(): void {
    setFlow(null);
  }

  let dialog: ReactNode = null;
  if (flow !== null) {
    switch (flow.stage) {
      case 'choose':
        dialog = (
          <DropDialog
            key="choose"
            board={board}
            ward={ward}
            options={flow.options}
            onCancel={cancelFlow}
            onConfirm={(op) => {
              setFlow(null);
              proceed(op);
            }}
          />
        );
        break;
      case 'second': {
        const notice = flow.pre.secondCalling;
        const destination = destinationLabel(board, flow.op);
        if (notice !== null && destination !== null) {
          dialog = (
            <SecondCallingDialog
              key="second"
              name={memberName(ward, notice.memberId)}
              notice={notice}
              destination={destination}
              onCancel={cancelFlow}
              onConfirm={() => {
                afterSecondCalling(flow.op, flow.pre);
              }}
            />
          );
        }
        break;
      }
      case 'approval':
        dialog = (
          <ApprovalDialog
            key="approval"
            approvals={flow.entries}
            proposalName={proposal?.name ?? ''}
            recordedAs={me.displayName}
            onCancel={cancelFlow}
            onConfirm={() => {
              commit(flow.op, flow.entries);
            }}
          />
        );
        break;
    }
  }

  return (
    <div
      ref={surfaceRef}
      className="wb-dnd-surface"
      data-dnd-enabled={readOnly ? 'false' : 'true'}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
    >
      {children}
      <div className="wb-dnd-layer">
        {highlight === null ? null : (
          <div
            className="wb-dnd-highlight"
            aria-hidden="true"
            style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }}
          >
            <span className="wb-dnd-highlight-label">Drop here</span>
          </div>
        )}
        {ghost === null ? null : (
          <div className="wb-dnd-ghost" data-dnd-ghost="" aria-hidden="true" style={{ left: ghost.x, top: ghost.y }}>
            <span className="wb-dnd-ghost-avatar" style={{ background: avatarColor(ghost.name) }}>
              {initials(ghost.name)}
            </span>
            <span className="wb-dnd-ghost-text">
              <span className="wb-dnd-ghost-name">{ghost.name}</span>
              {ghost.from === null ? null : <span className="wb-dnd-ghost-from">{`Moving from ${ghost.from}`}</span>}
            </span>
          </div>
        )}
        {alert === null ? null : (
          <div role="alert" className="wb-dnd-alert">
            <p className="wb-dnd-alert-text">{`Can't drop here: ${alert}`}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setAlert(null);
              }}
            >
              Dismiss
            </Button>
          </div>
        )}
        {dialog}
      </div>
    </div>
  );
}
