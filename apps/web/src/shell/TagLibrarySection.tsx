import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { tagId as toTagId, type TagId, type TagUsage, type Ward } from '@wardboard/core';
import type { RequestResult } from '../sync/protocol.ts';
import { TagLibrary } from '../features/tags/TagLibrary.tsx';
import { useSync, useSyncClient } from '../sync/react.tsx';
import './tag-library-section.css';

type UsageEntry = { readonly usage: TagUsage } | { readonly error: string };

interface UsageCache {
  /** The ward object these entries belong to; a new ward push drops them. */
  readonly ward: Ward | null;
  readonly entries: Readonly<Record<string, UsageEntry>>;
}

/** The Settings "Tags" section: the T-039 library wired to the sync client (SPEC §6). */
export function TagLibrarySection(): ReactElement {
  const client = useSyncClient();
  const { ward, boards, subscribedBoardId, open } = useSync();
  const headingId = useId();
  const [cache, setCache] = useState<UsageCache>({ ward: null, entries: {} });
  // Tags with a getTagUsage request outstanding: at most one per tag.
  const inFlight = useRef(new Set<string>());
  // The tag whose delete dialog was opened last; a ward push refetches its counts.
  const activeTag = useRef<TagId | null>(null);
  // The last-opened tag's latest reply, held across ward pushes while its refetch is out,
  // so an open dialog keeps its counts (and Delete) instead of flickering back to counting.
  const [held, setHeld] = useState<{ readonly tagId: TagId; readonly entry: UsageEntry } | null>(null);

  // A direct load of /settings has not subscribed to a board, so no ward has arrived.
  const currentId = boards?.current?.boardId ?? null;
  useEffect(() => {
    if (ward === null && subscribedBoardId === null && currentId !== null) open(currentId);
  }, [ward, subscribedBoardId, currentId, open]);
  const entries = cache.ward === ward ? cache.entries : {};

  const fetchUsage = useCallback(
    (tagId: TagId): void => {
      if (inFlight.current.has(tagId)) return;
      inFlight.current.add(tagId);
      void client.getTagUsage(tagId).then((result) => {
        inFlight.current.delete(tagId);
        const entry: UsageEntry = result.ok
          ? { usage: { members: result.members, callingPreferences: result.callingPreferences, callingTags: result.callingTags } }
          : { error: result.message };
        // The reply comes over the same ordered channel as ward pushes, after any push
        // already received, so it is current for the latest ward: keep it rather than
        // leave the dialog counting. A later push drops it and the effect below refetches.
        const latest = client.getState().ward;
        setCache((prev) => ({
          ward: latest,
          entries: { ...(prev.ward === latest ? prev.entries : {}), [tagId]: entry },
        }));
        if (activeTag.current === tagId) setHeld({ tagId, entry });
      });
    },
    [client],
  );

  const onDeleteRequested = useCallback(
    (tagId: TagId): void => {
      activeTag.current = tagId;
      // A fresh open never shows counts held from an earlier ward.
      setHeld(null);
      fetchUsage(tagId);
    },
    [fetchUsage],
  );

  // A ward push drops cached usage; refetch the last-opened tag so an open dialog never stays counting.
  // If its request is still out, that reply is kept instead (one request per tag at a time).
  useEffect(() => {
    const tagId = activeTag.current;
    if (ward === null || tagId === null) return;
    if (ward.tags[tagId] === undefined) {
      activeTag.current = null;
      return;
    }
    fetchUsage(tagId);
  }, [ward, fetchUsage]);

  const onCreateTag = async (name: string): Promise<RequestResult<{ tagId: TagId }>> => {
    const result = await client.createTag(name);
    return result.ok ? { ok: true, tagId: toTagId(result.tagId) } : result;
  };

  const entryOf = (tagId: TagId): UsageEntry | undefined =>
    entries[tagId] ?? (held !== null && held.tagId === tagId ? held.entry : undefined);

  const usageOf = (tagId: TagId): TagUsage | null => {
    const entry = entryOf(tagId);
    return entry !== undefined && 'usage' in entry ? entry.usage : null;
  };

  const usageErrorOf = (tagId: TagId): string | null => {
    const entry = entryOf(tagId);
    return entry !== undefined && 'error' in entry ? entry.error : null;
  };

  return (
    <section className="wb-tag-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="wb-tag-section-title">
        Tags
      </h2>
      {ward === null ? (
        <p className="wb-tag-section-note" role="status">
          Loading tags…
        </p>
      ) : (
        <TagLibrary
          ward={ward}
          usageOf={usageOf}
          usageErrorOf={usageErrorOf}
          onCreateTag={onCreateTag}
          onDeleteTag={client.deleteTag}
          onDeleteRequested={onDeleteRequested}
        />
      )}
    </section>
  );
}
