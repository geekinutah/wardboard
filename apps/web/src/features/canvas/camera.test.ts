import { describe, expect, it } from 'vitest';
import {
  cameraReducer,
  ENTER_SCALE,
  INITIAL_CAMERA,
  MAX_SCALE_DEEPEST,
  MIN_SCALE,
  WHEEL_FACTOR,
  type Camera,
  type ZoomTarget,
} from './camera.ts';

const ORG: ZoomTarget = { kind: 'org', id: 'primary' };
const GROUP: ZoomTarget = { kind: 'group', id: 'teachers' };

function contentPoint(camera: Camera, anchor: { x: number; y: number }): { x: number; y: number } {
  return {
    x: (anchor.x - camera.x) / camera.scale,
    y: (anchor.y - camera.y) / camera.scale,
  };
}

describe('cameraReducer', () => {
  it('wheel zoom keeps the anchor point fixed', () => {
    const camera: Camera = { level: 1, orgId: null, groupId: null, scale: 1.1, x: 30, y: -12 };
    const anchor = { x: 180, y: 90 };
    const next = cameraReducer(camera, { type: 'wheel', deltaY: -25, anchor, target: null });

    expect(next.scale).not.toBe(camera.scale);
    expect(next.level).toBe(1);
    const before = contentPoint(camera, anchor);
    const after = contentPoint(next, anchor);
    expect(Math.abs(before.x - after.x)).toBeLessThan(1e-9);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1e-9);
  });

  it('wheel in past ENTER_SCALE over an org goes to level 2 focused on it', () => {
    const camera: Camera = { level: 1, orgId: null, groupId: null, scale: 1, x: 10, y: 20 };
    const next = cameraReducer(camera, {
      type: 'wheel',
      deltaY: -1000,
      anchor: { x: 120, y: 80 },
      target: ORG,
    });

    expect(next).toEqual({ level: 2, orgId: 'primary', groupId: null, scale: 1, x: 0, y: 0 });
  });

  it('wheel in past ENTER_SCALE with no target clamps at ENTER_SCALE', () => {
    const camera: Camera = { level: 1, orgId: null, groupId: null, scale: 1, x: 10, y: 20 };
    const anchor = { x: 120, y: 80 };
    const next = cameraReducer(camera, { type: 'wheel', deltaY: -1000, anchor, target: null });

    expect(next.level).toBe(1);
    expect(next.orgId).toBeNull();
    expect(next.groupId).toBeNull();
    expect(next.scale).toBe(ENTER_SCALE);
    const before = contentPoint(camera, anchor);
    const after = contentPoint(next, anchor);
    expect(Math.abs(before.x - after.x)).toBeLessThan(1e-9);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1e-9);
  });

  it('wrong target kind does not change level', () => {
    const anchor = { x: 40, y: 50 };
    const level1: Camera = { level: 1, orgId: null, groupId: null, scale: 1, x: 2, y: 3 };
    const clamped1 = cameraReducer(level1, {
      type: 'wheel',
      deltaY: -800,
      anchor,
      target: GROUP,
    });
    expect(clamped1.level).toBe(1);
    expect(clamped1.orgId).toBeNull();
    expect(clamped1.groupId).toBeNull();
    expect(clamped1.scale).toBe(ENTER_SCALE);

    const level2: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1.1, x: 4, y: 5 };
    const clamped2 = cameraReducer(level2, {
      type: 'pinch',
      ratio: 3,
      anchor,
      target: ORG,
    });
    expect(clamped2.level).toBe(2);
    expect(clamped2.orgId).toBe('primary');
    expect(clamped2.groupId).toBeNull();
    expect(clamped2.scale).toBe(ENTER_SCALE);
  });

  it('level 2 to 3 keeps orgId and sets groupId', () => {
    const camera: Camera = { level: 2, orgId: 'elders-quorum', groupId: null, scale: 1, x: 8, y: 9 };
    const entered = cameraReducer(camera, { type: 'enter', target: { kind: 'group', id: 'music' } });
    expect(entered).toEqual({
      level: 3,
      orgId: 'elders-quorum',
      groupId: 'music',
      scale: 1,
      x: 0,
      y: 0,
    });

    const wheeled = cameraReducer(
      { ...camera, scale: 1.2 },
      {
        type: 'wheel',
        deltaY: -700,
        anchor: { x: 10, y: 10 },
        target: { kind: 'group', id: 'nursery' },
      },
    );
    expect(wheeled).toEqual({
      level: 3,
      orgId: 'elders-quorum',
      groupId: 'nursery',
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('level 3 clamps at MAX_SCALE_DEEPEST', () => {
    const camera: Camera = {
      level: 3,
      orgId: 'primary',
      groupId: 'teachers',
      scale: 2.6,
      x: 4,
      y: 5,
    };
    const anchor = { x: 10, y: 12 };
    const zoomed = cameraReducer(camera, { type: 'zoomIn', anchor, target: GROUP });
    expect(zoomed.level).toBe(3);
    expect(zoomed.orgId).toBe('primary');
    expect(zoomed.groupId).toBe('teachers');
    expect(zoomed.scale).toBe(MAX_SCALE_DEEPEST);

    const wheeled = cameraReducer(camera, { type: 'wheel', deltaY: -500, anchor, target: null });
    expect(wheeled.level).toBe(3);
    expect(wheeled.scale).toBe(MAX_SCALE_DEEPEST);
    expect(wheeled.groupId).toBe('teachers');

    const capped: Camera = { ...camera, scale: MAX_SCALE_DEEPEST };
    expect(cameraReducer(capped, { type: 'zoomIn', anchor, target: null })).toBe(capped);
  });

  it('wheel out below MIN_SCALE goes up one level and clears the deeper focus', () => {
    const level3: Camera = {
      level: 3,
      orgId: 'primary',
      groupId: 'teachers',
      scale: 0.7,
      x: 9,
      y: 4,
    };
    expect(
      cameraReducer(level3, { type: 'wheel', deltaY: 400, anchor: { x: 0, y: 0 }, target: null }),
    ).toEqual({ level: 2, orgId: 'primary', groupId: null, scale: 1, x: 0, y: 0 });
    expect(cameraReducer(level3, { type: 'up' })).toEqual({
      level: 2,
      orgId: 'primary',
      groupId: null,
      scale: 1,
      x: 0,
      y: 0,
    });

    const level2: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1, x: 20, y: 10 };
    expect(
      cameraReducer(level2, {
        type: 'wheel',
        deltaY: 400,
        anchor: { x: 1, y: 1 },
        target: ORG,
      }),
    ).toEqual({ level: 1, orgId: null, groupId: null, scale: 1, x: 0, y: 0 });
    expect(cameraReducer(level2, { type: 'up' })).toEqual(INITIAL_CAMERA);
  });

  it('level 1 clamps at MIN_SCALE and up is a no-op returning the same object', () => {
    const camera: Camera = { level: 1, orgId: null, groupId: null, scale: 0.75, x: 8, y: 14 };
    const anchor = { x: 50, y: 60 };
    const clamped = cameraReducer(camera, { type: 'wheel', deltaY: 800, anchor, target: null });
    expect(clamped.level).toBe(1);
    expect(clamped.scale).toBe(MIN_SCALE);
    expect(clamped.orgId).toBeNull();
    const before = contentPoint(camera, anchor);
    const after = contentPoint(clamped, anchor);
    expect(Math.abs(before.x - after.x)).toBeLessThan(1e-9);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1e-9);

    expect(cameraReducer(clamped, { type: 'up' })).toBe(clamped);
    expect(cameraReducer(INITIAL_CAMERA, { type: 'up' })).toBe(INITIAL_CAMERA);

    const zoomed: Camera = { ...INITIAL_CAMERA, scale: 1.4, x: 5, y: -2 };
    expect(cameraReducer(zoomed, { type: 'up' })).toBe(zoomed);
  });

  it('enter goes exactly one level deeper', () => {
    const level1 = INITIAL_CAMERA;
    const org = cameraReducer(level1, { type: 'enter', target: { kind: 'org', id: 'relief-society' } });
    expect(org).toEqual({
      level: 2,
      orgId: 'relief-society',
      groupId: null,
      scale: 1,
      x: 0,
      y: 0,
    });

    const group = cameraReducer(org, { type: 'enter', target: { kind: 'group', id: 'teachers' } });
    expect(group).toEqual({
      level: 3,
      orgId: 'relief-society',
      groupId: 'teachers',
      scale: 1,
      x: 0,
      y: 0,
    });

    expect(cameraReducer(level1, { type: 'enter', target: GROUP })).toBe(level1);
    expect(cameraReducer(org, { type: 'enter', target: { kind: 'org', id: 'primary' } })).toBe(org);
    expect(cameraReducer(group, { type: 'enter', target: { kind: 'group', id: 'nursery' } })).toBe(group);
  });

  it('fit returns INITIAL_CAMERA from any state', () => {
    const camera: Camera = { level: 3, orgId: 'primary', groupId: 'music', scale: 2.4, x: -30, y: 18 };
    expect(cameraReducer(camera, { type: 'fit' })).toEqual(INITIAL_CAMERA);
    expect(cameraReducer(INITIAL_CAMERA, { type: 'fit' })).toBe(INITIAL_CAMERA);
    const copy: Camera = { ...INITIAL_CAMERA };
    expect(cameraReducer(copy, { type: 'fit' })).toBe(copy);
  });

  it('pan never changes level or scale', () => {
    const camera: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1.35, x: 3, y: -7 };
    const next = cameraReducer(camera, { type: 'pan', dx: 12, dy: -5 });
    expect(next).toEqual({ ...camera, x: 15, y: -12 });
    expect(next.level).toBe(camera.level);
    expect(next.scale).toBe(camera.scale);
    expect(next.orgId).toBe(camera.orgId);
    expect(cameraReducer(camera, { type: 'pan', dx: 0, dy: 0 })).toBe(camera);
    expect(cameraReducer(camera, { type: 'pan', dx: Number.NaN, dy: 4 })).toBe(camera);
  });

  it('pinch uses ratio and midpoint anchor like wheel', () => {
    const camera: Camera = { level: 1, orgId: null, groupId: null, scale: 1.2, x: 15, y: -8 };
    const anchor = { x: 90, y: 40 };
    const ratio = 1.15;
    const pinched = cameraReducer(camera, { type: 'pinch', ratio, anchor, target: null });
    const deltaY = -Math.log(ratio) / WHEEL_FACTOR;
    const wheeled = cameraReducer(camera, { type: 'wheel', deltaY, anchor, target: null });

    expect(pinched.level).toBe(camera.level);
    expect(pinched.scale).toBeCloseTo(camera.scale * ratio, 10);
    expect(pinched.scale).toBeCloseTo(wheeled.scale, 8);
    expect(pinched.x).toBeCloseTo(wheeled.x, 8);
    expect(pinched.y).toBeCloseTo(wheeled.y, 8);
    const before = contentPoint(camera, anchor);
    const after = contentPoint(pinched, anchor);
    expect(Math.abs(before.x - after.x)).toBeLessThan(1e-9);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1e-9);
  });

  it('zoomIn crosses into the selection only when valid', () => {
    const anchor = { x: 25, y: 40 };
    const start: Camera = { ...INITIAL_CAMERA, scale: 1.2, x: 4, y: 6 };
    const below = cameraReducer(start, { type: 'zoomIn', anchor, target: ORG });
    expect(below.level).toBe(1);
    expect(below.orgId).toBeNull();
    expect(below.scale).toBeCloseTo(1.2 * 1.25, 10);
    const before = contentPoint(start, anchor);
    const after = contentPoint(below, anchor);
    expect(Math.abs(before.x - after.x)).toBeLessThan(1e-9);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1e-9);

    const crossing: Camera = { level: 1, orgId: null, groupId: null, scale: 1.5, x: 3, y: 4 };
    expect(cameraReducer(crossing, { type: 'zoomIn', anchor, target: ORG })).toEqual({
      level: 2,
      orgId: 'primary',
      groupId: null,
      scale: 1,
      x: 0,
      y: 0,
    });

    const wrong = cameraReducer(crossing, { type: 'zoomIn', anchor, target: GROUP });
    expect(wrong.level).toBe(1);
    expect(wrong.scale).toBe(ENTER_SCALE);
    expect(wrong.orgId).toBeNull();

    const missing = cameraReducer(crossing, { type: 'zoomIn', anchor, target: null });
    expect(missing.level).toBe(1);
    expect(missing.scale).toBe(ENTER_SCALE);

    const level2: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1.5, x: 1, y: 1 };
    expect(cameraReducer(level2, { type: 'zoomIn', anchor, target: GROUP })).toEqual({
      level: 3,
      orgId: 'primary',
      groupId: 'teachers',
      scale: 1,
      x: 0,
      y: 0,
    });
    const level2Wrong = cameraReducer(level2, { type: 'zoomIn', anchor, target: ORG });
    expect(level2Wrong.level).toBe(2);
    expect(level2Wrong.orgId).toBe('primary');
    expect(level2Wrong.scale).toBe(ENTER_SCALE);

    const deep: Camera = { level: 3, orgId: 'primary', groupId: 'teachers', scale: 2, x: 0, y: 0 };
    const enlarged = cameraReducer(deep, { type: 'zoomIn', anchor, target: GROUP });
    expect(enlarged.level).toBe(3);
    expect(enlarged.groupId).toBe('teachers');
    expect(enlarged.scale).toBeCloseTo(2.5, 10);
  });

  it('non-finite input leaves state unchanged', () => {
    const camera: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1.2, x: 6, y: 7 };
    expect(
      cameraReducer(camera, {
        type: 'wheel',
        deltaY: Number.NaN,
        anchor: { x: 1, y: 1 },
        target: null,
      }),
    ).toBe(camera);
    expect(
      cameraReducer(camera, {
        type: 'wheel',
        deltaY: Number.POSITIVE_INFINITY,
        anchor: { x: 1, y: 1 },
        target: ORG,
      }),
    ).toBe(camera);
    expect(
      cameraReducer(camera, {
        type: 'pinch',
        ratio: Number.POSITIVE_INFINITY,
        anchor: { x: 1, y: 1 },
        target: GROUP,
      }),
    ).toBe(camera);
    expect(
      cameraReducer(camera, {
        type: 'pinch',
        ratio: Number.NaN,
        anchor: { x: 1, y: 1 },
        target: null,
      }),
    ).toBe(camera);
    expect(
      cameraReducer(camera, {
        type: 'wheel',
        deltaY: 10,
        anchor: { x: Number.NaN, y: 0 },
        target: null,
      }),
    ).toBe(camera);
    expect(
      cameraReducer(camera, {
        type: 'zoomIn',
        anchor: { x: 0, y: Number.POSITIVE_INFINITY },
        target: GROUP,
      }),
    ).toBe(camera);
    expect(cameraReducer(camera, { type: 'pan', dx: Number.NEGATIVE_INFINITY, dy: 0 })).toBe(camera);
  });
});
