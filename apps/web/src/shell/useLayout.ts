import { useEffect, useState } from 'react';
import { chooseLayout, layoutOverride, LAYOUT_STORAGE_KEY, PHONE_MEDIA_QUERY, type Layout } from './layout.ts';

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function applyPersist(persist: Layout | 'clear' | 'keep'): void {
  if (persist === 'keep') return;
  try {
    if (persist === 'clear') window.sessionStorage.removeItem(LAYOUT_STORAGE_KEY);
    else window.sessionStorage.setItem(LAYOUT_STORAGE_KEY, persist);
  } catch {
    // Storage is unavailable; the choice just does not survive navigation.
  }
}

// Drops the `layout` parameter from the address once it has been read, so the
// override lives only in sessionStorage. replaceState keeps the history length.
function stripLayoutParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('layout')) return;
  url.searchParams.delete('layout');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function mediaList(): MediaQueryList | null {
  // jsdom has no matchMedia.
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(PHONE_MEDIA_QUERY);
}

export function useLayout(): Layout {
  const [override] = useState<Layout | null>(() => {
    const result = layoutOverride(window.location.search, readStored());
    applyPersist(result.persist);
    return result.override;
  });
  const [narrow, setNarrow] = useState<boolean>(() => mediaList()?.matches ?? false);

  useEffect(() => {
    stripLayoutParam();
  }, []);

  useEffect(() => {
    const list = mediaList();
    if (list === null) return;
    const onChange = (): void => {
      setNarrow(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, []);

  return chooseLayout(override, narrow);
}
