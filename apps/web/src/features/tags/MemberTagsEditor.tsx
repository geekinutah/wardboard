import { useId } from 'react';
import type { ReactElement } from 'react';
import type { Member, TagId, Ward } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { ErrorLine, TagChip, TagCombobox, useAction } from './shared.tsx';

export interface MemberTagsEditorProps {
  member: Member;
  ward: Ward;
  isAdmin: boolean;
  onSetTags: (tagIds: TagId[]) => Promise<RequestResult>;
  onCreateTag: (name: string) => Promise<RequestResult<{ tagId: TagId }>>;
  onSetNeedsApproval: (value: boolean) => Promise<RequestResult>;
}

/** Edits one member's ward-wide tags, plus the Admin-only Needs approval switch (SPEC §6). */
export function MemberTagsEditor({
  member,
  ward,
  isAdmin,
  onSetTags,
  onCreateTag,
  onSetNeedsApproval,
}: MemberTagsEditorProps): ReactElement {
  const headingId = useId();
  const helpId = useId();
  const action = useAction();
  const carried = member.tagIds;

  return (
    <section className="wb-tags-card" aria-labelledby={headingId}>
      <header className="wb-tags-head">
        <span className="wb-tags-eyebrow">MEMBER TAGS · WARD-WIDE</span>
        <h2 id={headingId} className="wb-tags-title">
          {member.name}
        </h2>
      </header>

      {carried.length > 0 ? (
        <div className="wb-tags-chips">
          {carried.map((id) => {
            const name = ward.tags[id]?.name ?? id;
            return (
              <TagChip
                key={id}
                name={name}
                removeLabel={`Remove tag ${name}`}
                disabled={action.pending}
                onRemove={() => {
                  void action.run(() => onSetTags(carried.filter((t) => t !== id)));
                }}
              />
            );
          })}
        </div>
      ) : null}

      <TagCombobox
        ward={ward}
        carried={carried}
        label="Add a tag"
        disabled={action.pending}
        onPick={(id) => {
          void action.run(() => onSetTags([...carried, id]));
        }}
        onCreate={(name) => {
          void action.run(async () => {
            const created = await onCreateTag(name);
            if (!created.ok) {
              return created;
            }
            return onSetTags([...carried, created.tagId]);
          });
        }}
      />
      <ErrorLine message={action.error} />
      <p className="wb-tags-note">Member tags are shared: changes show in Current and every proposal.</p>

      <div className="wb-tags-section wb-tags-section-ruled">
        <h3 className="wb-tags-label">Placement setting</h3>
        {isAdmin ? (
          <div className="wb-tags-approval">
            <button
              type="button"
              role="switch"
              aria-checked={member.needsApproval}
              aria-describedby={helpId}
              className="wb-tags-switch"
              disabled={action.pending}
              onClick={() => {
                void action.run(() => onSetNeedsApproval(!member.needsApproval));
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span className="wb-tags-switch-name">Needs approval</span>
              <span className="wb-tags-switch-state" aria-hidden="true">
                {member.needsApproval ? 'On' : 'Off'}
              </span>
              <span className="wb-tags-switch-track" aria-hidden="true" />
            </button>
            <span id={helpId} className="wb-tags-help">
              Every proposed placement must be approved by an Editor. Not a tag · shown on TV only if an Admin allows it.
            </span>
          </div>
        ) : (
          <div className="wb-tags-approval wb-tags-approval-static">
            <span className="wb-tags-switch-name">{`Needs approval: ${member.needsApproval ? 'On' : 'Off'}`}</span>
            <span className="wb-tags-help">Only Admins can change this.</span>
          </div>
        )}
      </div>
    </section>
  );
}
