import { useEffect, useReducer, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../design/Button.tsx';
import {
  cameraReducer,
  INITIAL_CAMERA,
  type Camera,
  type CameraAction,
  type Level,
  type ZoomTarget,
} from './camera.ts';
import './canvas.css';

export type SelectTarget = ZoomTarget | { kind: 'member'; id: string };

export type CanvasProps = {
  camera: Camera;
  onCameraChange: (action: CameraAction) => void;
  renderLevel: (camera: Camera) => ReactNode;
  onSelect: (target: SelectTarget) => void;
  onOpenNotes: (memberId: string) => void;
  selection: ZoomTarget | null;
};

const LEVEL_LABEL: Record<Level, string> = {
  1: 'Ward',
  2: 'Organization',
  3: 'Group',
};

// Under 4px of movement is a click, not a pan.
const CLICK_THRESHOLD_PX = 4;

type Point = { x: number; y: number };

type TrackedPointer = Point & { pointerType: string };

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; pointerId: number; startX: number; startY: number; origin: 'background' | 'blocked' }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'pinch'; lastDistance: number };

const ZOOM_TARGET_PATTERN = /^(org|group):(.+)$/u;

function parseZoomTarget(value: string | null): ZoomTarget | null {
  if (value === null) return null;
  const match = ZOOM_TARGET_PATTERN.exec(value);
  const kind = match?.[1];
  const id = match?.[2];
  if (id === undefined || id.length === 0) return null;
  if (kind === 'org') return { kind: 'org', id };
  if (kind === 'group') return { kind: 'group', id };
  return null;
}

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function zoomTargetFrom(target: EventTarget | null): ZoomTarget | null {
  const element = elementFromTarget(target);
  if (element === null) return null;
  const node = element.closest('[data-zoom-target]');
  if (node === null) return null;
  return parseZoomTarget(node.getAttribute('data-zoom-target'));
}

function memberIdFrom(target: EventTarget | null): string | null {
  const element = elementFromTarget(target);
  if (element === null) return null;
  const node = element.closest('[data-member-id]');
  if (node === null) return null;
  const id = node.getAttribute('data-member-id');
  if (id === null || id.length === 0) return null;
  return id;
}

function selectTargetFrom(target: EventTarget | null): SelectTarget | null {
  let node = elementFromTarget(target);
  while (node !== null) {
    if (node.hasAttribute('data-member-id')) {
      const id = node.getAttribute('data-member-id');
      if (id !== null && id.length > 0) return { kind: 'member', id };
    }
    if (node.hasAttribute('data-zoom-target')) {
      const zoom = parseZoomTarget(node.getAttribute('data-zoom-target'));
      if (zoom !== null) return zoom;
    }
    node = node.parentElement;
  }
  return null;
}

function isContentEditableElement(element: Element): boolean {
  // jsdom omits HTMLElement.isContentEditable, so fall back to the attribute.
  if (element instanceof HTMLElement && typeof element.isContentEditable === 'boolean') {
    return element.isContentEditable;
  }
  let node: Element | null = element;
  while (node !== null) {
    const value = node.getAttribute('contenteditable');
    if (value !== null) return value.toLowerCase() !== 'false';
    node = node.parentElement;
  }
  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = elementFromTarget(target);
  if (element === null) return false;
  if (element.closest('input, textarea, select') !== null) return true;
  return isContentEditableElement(element);
}

function isControlTarget(target: EventTarget | null): boolean {
  const element = elementFromTarget(target);
  if (element === null) return false;
  if (element.closest('button, a, input, textarea, select') !== null) return true;
  return isContentEditableElement(element);
}

function originOf(target: EventTarget | null): 'background' | 'blocked' {
  const element = elementFromTarget(target);
  if (element === null) return 'background';
  if (element.closest('[data-zoom-target], [data-member-id]') !== null) return 'blocked';
  return 'background';
}

function localPoint(viewport: HTMLElement, clientX: number, clientY: number): Point {
  const rect = viewport.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function pinchGeometry(pointers: ReadonlyMap<number, TrackedPointer>): { distance: number; mid: Point } | null {
  const touches: TrackedPointer[] = [];
  for (const pointer of pointers.values()) {
    if (pointer.pointerType !== 'touch' && pointer.pointerType !== 'pen') continue;
    touches.push(pointer);
    if (touches.length === 2) break;
  }
  const first = touches[0];
  const second = touches[1];
  if (first === undefined || second === undefined) return null;
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    mid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  };
}

function zoomTargetAt(viewport: HTMLElement, point: Point): ZoomTarget | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const rect = viewport.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + point.x, rect.top + point.y);
  return zoomTargetFrom(hit);
}

export function Canvas({
  camera,
  onCameraChange,
  renderLevel,
  onSelect,
  onOpenNotes,
  selection,
}: CanvasProps): ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const suppressClickRef = useRef(false);
  const onCameraChangeRef = useRef(onCameraChange);
  const onSelectRef = useRef(onSelect);
  const onOpenNotesRef = useRef(onOpenNotes);
  const selectionRef = useRef(selection);
  const moveRef = useRef<(event: globalThis.PointerEvent) => void>(() => undefined);
  const upRef = useRef<(event: globalThis.PointerEvent) => void>(() => undefined);
  onCameraChangeRef.current = onCameraChange;
  onSelectRef.current = onSelect;
  onOpenNotesRef.current = onOpenNotes;
  selectionRef.current = selection;

  moveRef.current = (event: globalThis.PointerEvent): void => {
    const tracked = pointersRef.current.get(event.pointerId);
    if (tracked === undefined) return;
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const point = localPoint(viewport, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, {
      x: point.x,
      y: point.y,
      pointerType: tracked.pointerType,
    });

    const gesture = gestureRef.current;
    if (gesture.kind === 'pinch') {
      const pinch = pinchGeometry(pointersRef.current);
      if (pinch === null || pinch.distance === 0) return;
      const ratio = gesture.lastDistance === 0 ? 1 : pinch.distance / gesture.lastDistance;
      gestureRef.current = { kind: 'pinch', lastDistance: pinch.distance };
      if (!Number.isFinite(ratio) || ratio === 1) return;
      onCameraChangeRef.current({
        type: 'pinch',
        ratio,
        anchor: pinch.mid,
        target: zoomTargetAt(viewport, pinch.mid),
      });
      return;
    }

    if (gesture.kind === 'pending' && gesture.pointerId === event.pointerId) {
      const dx = point.x - gesture.startX;
      const dy = point.y - gesture.startY;
      if (Math.hypot(dx, dy) < CLICK_THRESHOLD_PX) return;
      suppressClickRef.current = true;
      if (gesture.origin === 'background') {
        gestureRef.current = { kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y };
        onCameraChangeRef.current({ type: 'pan', dx, dy });
      } else {
        gestureRef.current = { kind: 'idle' };
      }
      return;
    }

    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      const dx = point.x - gesture.lastX;
      const dy = point.y - gesture.lastY;
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      if (dx === 0 && dy === 0) return;
      onCameraChangeRef.current({ type: 'pan', dx, dy });
    }
  };

  upRef.current = (event: globalThis.PointerEvent): void => {
    pointersRef.current.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (pointersRef.current.size === 0) {
      gestureRef.current = { kind: 'idle' };
      return;
    }
    if (gesture.kind === 'pinch' && pinchGeometry(pointersRef.current) === null) {
      gestureRef.current = { kind: 'idle' };
      return;
    }
    if ((gesture.kind === 'pending' || gesture.kind === 'pan') && gesture.pointerId === event.pointerId) {
      gestureRef.current = { kind: 'idle' };
    }
  };

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent): void => {
      moveRef.current(event);
    };
    const onUp = (event: globalThis.PointerEvent): void => {
      upRef.current(event);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    // React's onWheel is passive, so it cannot cancel page scrolling.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      onCameraChangeRef.current({
        type: 'wheel',
        deltaY: event.deltaY,
        anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        target: zoomTargetFrom(event.target),
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (isControlTarget(event.target)) return;
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const point = localPoint(viewport, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, {
      x: point.x,
      y: point.y,
      pointerType: event.pointerType,
    });
    if (!isEditableTarget(event.target)) {
      canvasRef.current?.focus({ preventScroll: true });
    }
    const pinch = pinchGeometry(pointersRef.current);
    if (pinch !== null) {
      suppressClickRef.current = true;
      gestureRef.current = { kind: 'pinch', lastDistance: pinch.distance };
      return;
    }
    if (pointersRef.current.size === 1) {
      suppressClickRef.current = false;
      gestureRef.current = {
        kind: 'pending',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        origin: originOf(event.target),
      };
    }
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (isControlTarget(event.target)) return;
    const target = selectTargetFrom(event.target);
    if (target !== null) onSelectRef.current(target);
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>): void {
    if (isControlTarget(event.target)) return;
    const memberId = memberIdFrom(event.target);
    if (memberId !== null) {
      onOpenNotesRef.current(memberId);
      return;
    }
    const zoom = zoomTargetFrom(event.target);
    if (zoom !== null) onCameraChangeRef.current({ type: 'enter', target: zoom });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    onCameraChangeRef.current({ type: 'up' });
  }

  function emitZoomIn(): void {
    const rect = viewportRef.current?.getBoundingClientRect();
    onCameraChangeRef.current({
      type: 'zoomIn',
      anchor: { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 },
      target: selectionRef.current,
    });
  }

  function emitUp(): void {
    onCameraChangeRef.current({ type: 'up' });
  }

  function emitFit(): void {
    onCameraChangeRef.current({ type: 'fit' });
  }

  return (
    <div
      ref={canvasRef}
      className="wb-canvas"
      role="region"
      aria-label="Board canvas"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="wb-canvas-toolbar" role="toolbar" aria-label="Zoom">
        <span className="wb-canvas-level" aria-live="polite">
          {LEVEL_LABEL[camera.level]}
        </span>
        <Button variant="secondary" onClick={emitZoomIn}>Zoom in</Button>
        <Button variant="secondary" onClick={emitUp}>Zoom out</Button>
        <Button variant="secondary" onClick={emitFit}>Fit ward</Button>
      </div>
      <div
        ref={viewportRef}
        className="wb-canvas-viewport"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="wb-canvas-layer"
          style={{
            transform: `translate(${String(camera.x)}px, ${String(camera.y)}px) scale(${String(camera.scale)})`,
          }}
        >
          {renderLevel(camera)}
        </div>
      </div>
    </div>
  );
}

export function useCamera(): [Camera, (action: CameraAction) => void] {
  return useReducer(cameraReducer, INITIAL_CAMERA);
}
