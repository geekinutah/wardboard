export type Level = 1 | 2 | 3;

export type ZoomTarget = { kind: 'org'; id: string } | { kind: 'group'; id: string };

export type Camera = {
  level: Level;
  orgId: string | null;
  groupId: string | null;
  scale: number;
  x: number;
  y: number;
};

export const INITIAL_CAMERA: Camera = {
  level: 1,
  orgId: null,
  groupId: null,
  scale: 1,
  x: 0,
  y: 0,
};

export const MIN_SCALE = 0.6;
export const ENTER_SCALE = 1.8;
export const MAX_SCALE_DEEPEST = 3;
export const WHEEL_FACTOR = 0.002;

const ZOOM_IN_FACTOR = 1.25;

export type CameraAction =
  | { type: 'wheel'; deltaY: number; anchor: { x: number; y: number }; target: ZoomTarget | null }
  | { type: 'pinch'; ratio: number; anchor: { x: number; y: number }; target: ZoomTarget | null }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'enter'; target: ZoomTarget }
  | { type: 'zoomIn'; anchor: { x: number; y: number }; target: ZoomTarget | null }
  | { type: 'up' }
  | { type: 'fit' };

type Point = { x: number; y: number };

function sameCamera(camera: Camera, next: Camera): boolean {
  return (
    next.level === camera.level &&
    next.orgId === camera.orgId &&
    next.groupId === camera.groupId &&
    next.scale === camera.scale &&
    next.x === camera.x &&
    next.y === camera.y
  );
}

function commit(camera: Camera, next: Camera): Camera {
  return sameCamera(camera, next) ? camera : next;
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isDeeperTarget(level: Level, target: ZoomTarget | null): target is ZoomTarget {
  if (target === null) return false;
  if (level === 1) return target.kind === 'org';
  if (level === 2) return target.kind === 'group';
  return false;
}

function anchored(camera: Camera, newScale: number, anchor: Point): Camera {
  const ratio = newScale / camera.scale;
  const x = anchor.x - (anchor.x - camera.x) * ratio;
  const y = anchor.y - (anchor.y - camera.y) * ratio;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(newScale)) return camera;
  return { ...camera, scale: newScale, x, y };
}

function goDeeper(camera: Camera, target: ZoomTarget): Camera {
  if (camera.level === 1 && target.kind === 'org') {
    return commit(camera, { level: 2, orgId: target.id, groupId: null, scale: 1, x: 0, y: 0 });
  }
  if (camera.level === 2 && target.kind === 'group') {
    return commit(camera, {
      level: 3,
      orgId: camera.orgId,
      groupId: target.id,
      scale: 1,
      x: 0,
      y: 0,
    });
  }
  return camera;
}

function goUp(camera: Camera): Camera {
  if (camera.level === 1) return camera;
  if (camera.level === 3) {
    return commit(camera, { level: 2, orgId: camera.orgId, groupId: null, scale: 1, x: 0, y: 0 });
  }
  return commit(camera, { level: 1, orgId: null, groupId: null, scale: 1, x: 0, y: 0 });
}

function scaleAround(camera: Camera, newScale: number, anchor: Point, target: ZoomTarget | null): Camera {
  if (!Number.isFinite(newScale) || !Number.isFinite(camera.scale) || camera.scale <= 0) return camera;
  if (!isFinitePoint(anchor)) return camera;

  if ((camera.level === 1 || camera.level === 2) && newScale > ENTER_SCALE) {
    if (isDeeperTarget(camera.level, target)) return goDeeper(camera, target);
    return commit(camera, anchored(camera, ENTER_SCALE, anchor));
  }

  if (newScale < MIN_SCALE) {
    if (camera.level === 1) return commit(camera, anchored(camera, MIN_SCALE, anchor));
    return goUp(camera);
  }

  if (camera.level === 3 && newScale > MAX_SCALE_DEEPEST) {
    return commit(camera, anchored(camera, MAX_SCALE_DEEPEST, anchor));
  }

  return commit(camera, anchored(camera, newScale, anchor));
}

function reduceWheel(camera: Camera, deltaY: number, anchor: Point, target: ZoomTarget | null): Camera {
  if (!Number.isFinite(deltaY) || !isFinitePoint(anchor)) return camera;
  const factor = Math.exp(-deltaY * WHEEL_FACTOR);
  if (!Number.isFinite(factor)) return camera;
  return scaleAround(camera, camera.scale * factor, anchor, target);
}

function reducePinch(camera: Camera, ratio: number, anchor: Point, target: ZoomTarget | null): Camera {
  if (!Number.isFinite(ratio) || !isFinitePoint(anchor)) return camera;
  return scaleAround(camera, camera.scale * ratio, anchor, target);
}

function reducePan(camera: Camera, dx: number, dy: number): Camera {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return camera;
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return camera;
  const x = camera.x + dx;
  const y = camera.y + dy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return camera;
  return commit(camera, { ...camera, x, y });
}

function reduceEnter(camera: Camera, target: ZoomTarget): Camera {
  if (!isDeeperTarget(camera.level, target)) return camera;
  return goDeeper(camera, target);
}

function reduceZoomIn(camera: Camera, anchor: Point, target: ZoomTarget | null): Camera {
  if (!isFinitePoint(anchor) || !Number.isFinite(camera.scale)) return camera;
  return scaleAround(camera, camera.scale * ZOOM_IN_FACTOR, anchor, target);
}

function reduceFit(camera: Camera): Camera {
  return sameCamera(camera, INITIAL_CAMERA) ? camera : INITIAL_CAMERA;
}

export function cameraReducer(camera: Camera, action: CameraAction): Camera {
  switch (action.type) {
    case 'wheel':
      return reduceWheel(camera, action.deltaY, action.anchor, action.target);
    case 'pinch':
      return reducePinch(camera, action.ratio, action.anchor, action.target);
    case 'pan':
      return reducePan(camera, action.dx, action.dy);
    case 'enter':
      return reduceEnter(camera, action.target);
    case 'zoomIn':
      return reduceZoomIn(camera, action.anchor, action.target);
    case 'up':
      return goUp(camera);
    case 'fit':
      return reduceFit(camera);
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
