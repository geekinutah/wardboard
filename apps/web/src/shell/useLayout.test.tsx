import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_STORAGE_KEY, PHONE_MEDIA_QUERY } from './layout.ts';
import { useLayout } from './useLayout.ts';

type Listener = () => void;

function stubMatchMedia(initial: boolean): { flip: (matches: boolean) => void; queries: string[] } {
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  const mql = {
    matches: initial,
    addEventListener: (_type: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_type: string, fn: Listener) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return mql;
  });
  return {
    queries,
    flip(matches) {
      mql.matches = matches;
      for (const fn of listeners) fn();
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useLayout', () => {
  it('useLayout follows the media query', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('desktop');
    expect(media.queries).toContain(PHONE_MEDIA_QUERY);
    act(() => {
      media.flip(true);
    });
    expect(result.current).toBe('phone');
    act(() => {
      media.flip(false);
    });
    expect(result.current).toBe('desktop');
  });

  it('useLayout without matchMedia is desktop', () => {
    expect(Reflect.get(window, 'matchMedia')).toBeUndefined();
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('desktop');
  });

  it('useLayout removes the layout parameter from the address', () => {
    stubMatchMedia(true);
    window.history.replaceState(null, '', '/?layout=desktop&x=1#h');
    const lengthBefore = window.history.length;
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('desktop');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?x=1#h');
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);
    expect(window.sessionStorage.getItem(LAYOUT_STORAGE_KEY)).toBe('desktop');
  });

  it('useLayout leaves an address without a layout parameter alone', () => {
    stubMatchMedia(false);
    window.history.replaceState(null, '', '/settings?x=1#h');
    const replace = vi.spyOn(window.history, 'replaceState');
    renderHook(() => useLayout());
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/settings?x=1#h');
  });

  it('useLayout survives a sessionStorage error', () => {
    stubMatchMedia(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    window.history.replaceState(null, '', '/?layout=desktop');
    const { result } = renderHook(() => useLayout());
    expect(result.current).toBe('desktop');
    window.history.replaceState(null, '', '/');
    const second = renderHook(() => useLayout());
    expect(second.result.current).toBe('phone');
  });

  it('persists the override across a later load without the param', () => {
    stubMatchMedia(true);
    window.history.replaceState(null, '', '/?layout=desktop');
    renderHook(() => useLayout());
    expect(window.sessionStorage.getItem(LAYOUT_STORAGE_KEY)).toBe('desktop');
    window.history.replaceState(null, '', '/');
    expect(renderHook(() => useLayout()).result.current).toBe('desktop');
    window.history.replaceState(null, '', '/?layout=auto');
    expect(renderHook(() => useLayout()).result.current).toBe('phone');
    expect(window.sessionStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });
});
