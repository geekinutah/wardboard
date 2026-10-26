import { describe, expect, it } from 'vitest';
import { assertNever } from '../../src/index.ts';

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('assertNever', () => {
  it('assertNever throws with the serialized value', () => {
    const error = captureError(() => assertNever({ kind: 'bogus' } as never));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('{"kind":"bogus"}');
  });

  it('assertNever uses a custom message prefix when given', () => {
    const error = captureError(() => assertNever({ kind: 'bogus' } as never, 'Unknown operation kind'));

    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message.startsWith('Unknown operation kind')).toBe(true);
    expect(message).toContain('{"kind":"bogus"}');
  });

  it('assertNever survives unserializable values', () => {
    const circular: { kind: string; self?: unknown } = { kind: 'loop' };
    circular.self = circular;

    const error = captureError(() => assertNever(circular as never));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('[object Object]');
  });

  it('assertNever includes primitive values in the message', () => {
    const error = captureError(() => assertNever('mystery' as never));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"mystery"');
  });

  it('assertNever names values JSON cannot represent, such as undefined', () => {
    const error = captureError(() => assertNever(undefined as never));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/: undefined$/);
  });
});
