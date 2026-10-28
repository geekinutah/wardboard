import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { AssignmentId, Board, CallingGroupId, MemberId, TagId, Ward } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { ErrorLine, TagChip, TagCombobox, useAction } from './shared.tsx';
import { dugoutMatches } from './tag-model.ts';

export interface CallingTagsEditorProps {
  board: Board;
  ward: Ward;
  assignmentId: AssignmentId;
  /** Null (or any board that is not a proposal) renders the calling read-only. */
  proposalName: string | null;
  dugoutMemberIds: readonly MemberId[];
  onSetCallingTags: (tagIds: TagId[]) => Promise<RequestResult>;
  onSetPreferences: (tagIds: TagId[]) => Promise<RequestResult>;
  onHighlight: (memberIds: MemberId[]) => void;
}

/** The name of the board group that contains the calling, following group parents upward. */
function rootGroupName(board: Board, groupId: CallingGroupId): string {
  let current = board.callingGroups[groupId];
  for (let guard = 0; current !== undefined && guard < 64; guard += 1) {
    if (current.parent.kind === 'boardGroup') {
      return board.boardGroups[current.parent.id]?.name ?? '';
    }
    current = board.callingGroups[current.parent.id];
  }
  return '';
}

interface TagListProps {
  heading: string;
  help: string;
  addLabel: string;
  pickerLabel: string;
  removePrefix: string;
  tone: 'plain' | 'accent';
  ids: readonly TagId[];
  ward: Ward;
  editable: boolean;
  onChange: (ids: TagId[]) => Promise<RequestResult>;
}

function TagList({
  heading,
  help,
  addLabel,
  pickerLabel,
  removePrefix,
  tone,
  ids,
  ward,
  editable,
  onChange,
}: TagListProps): ReactElement {
  const action = useAction();
  const [picking, setPicking] = useState(false);
  return (
    <div className="wb-tags-section">
      <h3 className="wb-tags-label">{heading}</h3>
      <div className="wb-tags-chips">
        {ids.map((id) => {
          const name = ward.tags[id]?.name ?? id;
          return (
            <TagChip
              key={id}
              name={name}
              tone={tone}
              removeLabel={editable ? `${removePrefix} ${name}` : null}
              disabled={action.pending}
              onRemove={() => {
                void action.run(() => onChange(ids.filter((t) => t !== id)));
              }}
            />
          );
        })}
        {!editable && ids.length === 0 ? <span className="wb-tags-none">None</span> : null}
        {editable && !picking ? (
          <button
            type="button"
            className={`wb-tags-add wb-tags-add-${tone}`}
            disabled={action.pending}
            onClick={() => {
              setPicking(true);
            }}
          >
            {addLabel}
          </button>
        ) : null}
      </div>
      {editable && picking ? (
        <TagCombobox
          ward={ward}
          carried={ids}
          label={pickerLabel}
          autoFocus
          disabled={action.pending}
          onDismiss={() => {
            setPicking(false);
          }}
          onPick={(id) => {
            setPicking(false);
            void action.run(() => onChange([...ids, id]));
          }}
        />
      ) : null}
      <ErrorLine message={action.error} />
      <span className="wb-tags-help">{help}</span>
    </div>
  );
}

/** Calling tags and preferred member tags (affinities) for one calling (SPEC §6). */
export function CallingTagsEditor({
  board,
  ward,
  assignmentId,
  proposalName,
  dugoutMemberIds,
  onSetCallingTags,
  onSetPreferences,
  onHighlight,
}: CallingTagsEditorProps): ReactElement {
  const headingId = useId();
  const assignment = board.assignments[assignmentId];
  if (assignment === undefined) {
    return (
      <section className="wb-tags-card">
        <p className="wb-tags-note">Calling not found.</p>
      </section>
    );
  }

  const editable = board.kind === 'proposal' && proposalName !== null;
  const positions = Object.values(board.positions).filter((p) => p.assignmentId === assignmentId);
  const filled = positions.filter((p) => Object.hasOwn(board.placements, p.id)).length;
  const subtitle = [
    rootGroupName(board, assignment.groupId),
    assignment.type,
    ...(assignment.type === 'list' ? [`${String(filled)} of ${String(positions.length)} filled`] : []),
  ].join(' · ');
  const matches = dugoutMatches(board, ward, assignmentId, dugoutMemberIds);

  return (
    <section className="wb-tags-card" aria-labelledby={headingId}>
      <header className="wb-tags-head">
        <span className="wb-tags-eyebrow">{editable ? 'CALLING · THIS PROPOSAL ONLY' : 'CALLING'}</span>
        <h2 id={headingId} className="wb-tags-title">
          {assignment.title}
        </h2>
        <span className="wb-tags-subtitle">{subtitle}</span>
      </header>

      <TagList
        heading="Calling tags"
        help="Describe the calling itself."
        addLabel="+ Tag"
        pickerLabel="Add a calling tag"
        removePrefix="Remove calling tag"
        tone="plain"
        ids={assignment.callingTagIds}
        ward={ward}
        editable={editable}
        onChange={onSetCallingTags}
      />
      <TagList
        heading="Prefers members tagged"
        help="Preferences, not requirements — a missing tag never blocks a placement."
        addLabel="+ Preference"
        pickerLabel="Add a preference"
        removePrefix="Remove preference"
        tone="accent"
        ids={assignment.preferredMemberTagIds}
        ward={ward}
        editable={editable}
        onChange={onSetPreferences}
      />

      {matches.length > 0 ? (
        <div className="wb-tags-matches">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
          <span className="wb-tags-matches-text">
            {`${String(matches.length)} ${matches.length === 1 ? 'person' : 'people'} in the dugout match a preference`}
          </span>
          <button
            type="button"
            className="wb-tags-small-button"
            onClick={() => {
              onHighlight(matches);
            }}
          >
            Highlight
          </button>
        </div>
      ) : null}

      {editable ? (
        <p className="wb-tags-note">
          Changes apply to <strong>{proposalName}</strong>. Current and other proposals keep their own calling tags.
        </p>
      ) : null}
    </section>
  );
}
