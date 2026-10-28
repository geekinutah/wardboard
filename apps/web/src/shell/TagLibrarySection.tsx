import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { tagId as toTagId, type TagId, type TagUsage, type Ward } from '@wardboard/core';
import type { RequestResult } from '../sync/protocol.ts';
import { TagLibrary } from '../features/tags/TagLibrary.tsx';
import { useSync, useSyncClient } from '../sync/react.tsx';
import './tag-library-section.css';

type UsageEntry = { readonly usage: TagUsage } | { readonly error: string };

interface UsageCache {
  /** The ward object these entries were fetched against; a new ward push drops them. */
  readonly ward: Ward | null;
  readonly entries: Readonly<Record<string, UsageEntry>>;
}

/** The Settings "Tags" section: the T-039 library wired to the sync client (SPEC §6). */
export function TagLibrarySection(): ReactElement {
  const client = useSyncClient();
  const { ward, boards, subscribedBoardId, open } = useSync();
  const headingId = useId();
  const [cache, setCache] = useState<UsageCache>({ ward: null, entries: {} });
  const wardRef = useRef<Ward | null>(ward);
  wardRef.current = ward;
  // A direct load of /settings has not subscribed to a board, so no ward has arrived.
  const currentId = boards?.current?.boardId ?? null;
  useEffect(() => {
    if (ward === null && subscribedBoardId === null && currentId !== null) open(currentId);
  }, [ward, subscribedBoardId, currentId, open]);
  const entries = cache.ward === ward ? cache.entries : {};

  const onDeleteRequested = useCallback(
    (tagId: TagId): void => {
      const requested = wardRef.current;
      void client.getTagUsage(tagId).then((result) => {
        // A ward push since the request means these counts may be stale.
        if (wardRef.current !== requested) return;
        const entry: UsageEntry = result.ok
          ? { usage: { members: result.members, callingPreferences: result.callingPreferences, callingTags: result.callingTags } }
          : { error: result.message };
        setCache((prev) => ({
          ward: requested,
          entries: { ...(prev.ward === requested ? prev.entries : {}), [tagId]: entry },
        }));
      });
    },
    [client],
  );

  const onCreateTag = async (name: string): Promise<RequestResult<{ tagId: TagId }>> => {
    const result = await client.createTag(name);
    return result.ok ? { ok: true, tagId: toTagId(result.tagId) } : result;
  };

  const usageOf = (tagId: TagId): TagUsage | null => {
    const entry = entries[tagId];
    return entry !== undefined && 'usage' in entry ? entry.usage : null;
  };

  const failures = Object.values(entries).flatMap((entry) => ('error' in entry ? [entry.error] : []));

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
          onCreateTag={onCreateTag}
          onDeleteTag={client.deleteTag}
          onDeleteRequested={onDeleteRequested}
        />
      )}
      {failures.map((message) => (
        <p key={message} role="alert" className="wb-tag-section-alert">
          {`Couldn't count where it's used: ${message}`}
        </p>
      ))}
    </section>
  );
}
