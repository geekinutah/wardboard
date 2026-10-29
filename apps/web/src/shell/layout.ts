export type Layout = 'phone' | 'desktop';
export const LAYOUT_STORAGE_KEY = 'wardboard.layout';
export const PHONE_MEDIA_QUERY = '(max-width: 640px)';

function isLayout(value: string | null): value is Layout {
  return value === 'desktop' || value === 'phone';
}

/** Reads `?layout=` (first value wins) and the stored choice; says what to persist. */
export function layoutOverride(
  search: string,
  stored: string | null,
): { override: Layout | null; persist: Layout | 'clear' | 'keep' } {
  const param = new URLSearchParams(search).get('layout');
  if (isLayout(param)) return { override: param, persist: param };
  if (param === 'auto') return { override: null, persist: 'clear' };
  return { override: isLayout(stored) ? stored : null, persist: 'keep' };
}

export function chooseLayout(override: Layout | null, narrow: boolean): Layout {
  if (override !== null) return override;
  return narrow ? 'phone' : 'desktop';
}
