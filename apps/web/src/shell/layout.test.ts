import { describe, expect, it } from 'vitest';
import { chooseLayout, layoutOverride } from './layout.ts';

describe('layoutOverride', () => {
  it('layout=desktop and layout=phone override and persist', () => {
    expect(layoutOverride('?layout=desktop', null)).toEqual({ override: 'desktop', persist: 'desktop' });
    expect(layoutOverride('?layout=phone', 'desktop')).toEqual({ override: 'phone', persist: 'phone' });
  });

  it('layout=auto clears the stored override', () => {
    expect(layoutOverride('?layout=auto', 'desktop')).toEqual({ override: null, persist: 'clear' });
  });

  it('stored value applies without a param', () => {
    expect(layoutOverride('', 'phone')).toEqual({ override: 'phone', persist: 'keep' });
    expect(layoutOverride('', 'desktop')).toEqual({ override: 'desktop', persist: 'keep' });
    expect(layoutOverride('', 'tablet')).toEqual({ override: null, persist: 'keep' });
    expect(layoutOverride('', null)).toEqual({ override: null, persist: 'keep' });
  });

  it('unknown or differently cased values are ignored', () => {
    expect(layoutOverride('?layout=Desktop', 'phone')).toEqual({ override: 'phone', persist: 'keep' });
    expect(layoutOverride('?layout=wide', null)).toEqual({ override: null, persist: 'keep' });
  });

  it('first layout param wins', () => {
    expect(layoutOverride('?layout=phone&layout=desktop', null)).toEqual({ override: 'phone', persist: 'phone' });
  });
});

describe('chooseLayout', () => {
  it('chooseLayout prefers the override, then width', () => {
    expect(chooseLayout('desktop', true)).toBe('desktop');
    expect(chooseLayout('phone', false)).toBe('phone');
    expect(chooseLayout(null, true)).toBe('phone');
    expect(chooseLayout(null, false)).toBe('desktop');
  });
});
