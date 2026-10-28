import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  ONE_CALLING_GUIDANCE,
  type Board,
  type MemberId,
  type OutsideAwareNotice,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { Button } from '../../design/Button.tsx';
import { cx } from '../../design/cx.ts';
import { joinLabel, lowerFirst, memberName, positionLabel, type CallingLabel } from './labels.ts';
import type { DropOp } from './types.ts';

interface ShellProps {
  readonly titleId: string;
  readonly onCancel: () => void;
  readonly initialFocus: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Modal frame shared by the drop dialogs: backdrop, focus on open, Escape = Cancel. */
function DialogShell({ titleId, onCancel, initialFocus, className, children }: ShellProps): ReactElement {
  useEffect(() => {
    initialFocus.current?.focus();
  }, [initialFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  return (
    <div className="wb-dnd-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('wb-dnd-dialog', className)}>
        {children}
      </div>
    </div>
  );
}

export type DropChoice = { readonly choice: 'swap' | 'release_occupant'; readonly op: DropOp };

export interface DropDialogProps {
  readonly board: Board;
  readonly ward: Ward;
  readonly options: readonly DropChoice[];
  readonly onConfirm: (op: DropOp) => void;
  readonly onCancel: () => void;
}

function choiceName(choice: DropChoice['choice']): string {
  return choice === 'swap' ? 'Swap' : 'Release occupant';
}

/** Artboard 3: a drop on an occupied single calling. */
export function DropDialog({ board, ward, options, onConfirm, onCancel }: DropDialogProps): ReactElement {
  const prefix = useId();
  const titleId = `${prefix}-title`;
  const [selected, setSelected] = useState(0);
  const firstRadio = useRef<HTMLInputElement>(null);

  const first = options[0];
  if (first === undefined || (first.op.kind !== 'swap' && first.op.kind !== 'releaseOccupant')) {
    throw new Error('DropDialog needs at least one swap or release occupant option');
  }
  const { memberId, to } = first.op.request;
  const target = positionLabel(board, to);
  const occupant: MemberId | undefined = board.placements[to];
  const dragged = memberName(ward, memberId);
  const displaced = occupant === undefined ? '' : memberName(ward, occupant);

  function describe(option: DropChoice): string {
    if (option.op.kind === 'swap') {
      const source = positionLabel(board, option.op.request.from);
      return `${dragged} takes ${target.title}. ${displaced} takes ${source.title}.`;
    }
    return `${dragged} takes ${target.title}. ${displaced} is released from it.`;
  }

  const chosen = options[selected] ?? first;

  return (
    <DialogShell titleId={titleId} onCancel={onCancel} initialFocus={firstRadio} className="wb-dnd-drop-dialog">
      <div className="wb-dnd-dialog-head">
        <h2 id={titleId} className="wb-dnd-dialog-title">{`${target.title} is filled`}</h2>
        <p className="wb-dnd-dialog-sub">{joinLabel(target)}</p>
        <p className="wb-dnd-dialog-text">
          {`You dropped ${dragged} onto ${displaced}'s calling. Choose what this proposal should show.`}
        </p>
      </div>
      <fieldset className="wb-dnd-options">
        <legend className="wb-dnd-visually-hidden">What this proposal should show</legend>
        {options.map((option, index) => (
          <label key={option.choice} className={cx('wb-dnd-option', index === selected ? 'is-checked' : undefined)}>
            <input
              ref={index === 0 ? firstRadio : undefined}
              type="radio"
              name={`${prefix}-choice`}
              value={option.choice}
              checked={index === selected}
              onChange={() => {
                setSelected(index);
              }}
            />
            <span className="wb-dnd-option-text">
              <span className="wb-dnd-option-name">{choiceName(option.choice)}</span>
              <span className="wb-dnd-option-detail">{describe(option)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="wb-dnd-dialog-foot">
        <p className="wb-dnd-dialog-note">Applied as one change for everyone viewing.</p>
        <div className="wb-dnd-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm(chosen.op);
            }}
          >
            {choiceName(chosen.choice)}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

export interface SecondCallingDialogProps {
  readonly name: string;
  readonly notice: OutsideAwareNotice;
  readonly destination: CallingLabel;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Artboard 12: the second-calling confirmation, counting outside callings. */
export function SecondCallingDialog({ name, notice, destination, onConfirm, onCancel }: SecondCallingDialogProps): ReactElement {
  const titleId = `${useId()}-title`;
  const cancel = useRef<HTMLButtonElement>(null);
  const second = notice.countAfter === 2;
  const heading = second ? `Give ${name} a second calling?` : `Give ${name} another calling?`;
  const guidance = `The ${ONE_CALLING_GUIDANCE.source} says ${lowerFirst(ONE_CALLING_GUIDANCE.text)}`;

  return (
    <DialogShell titleId={titleId} onCancel={onCancel} initialFocus={cancel} className="wb-dnd-second-dialog">
      <h2 id={titleId} className="wb-dnd-dialog-title">
        {heading}
      </h2>
      <ul className="wb-dnd-callings">
        {notice.existing.map((calling) => (
          <li key={calling.positionId}>{`Already serves as ${calling.title}`}</li>
        ))}
        {notice.outside.map((calling) => (
          <li key={`${calling.unit}|${calling.title}`}>{`Serves outside the ward as ${calling.title} · ${calling.unit}`}</li>
        ))}
        <li className="wb-dnd-adding">{`Adding ${joinLabel(destination)}`}</li>
      </ul>
      <p className="wb-dnd-dialog-guidance">{guidance}</p>
      <div className="wb-dnd-dialog-actions wb-dnd-dialog-actions-end">
        <button ref={cancel} type="button" className="wb-button wb-button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <Button variant="secondary" className="wb-dnd-confirm-outline" onClick={onConfirm}>
          {second ? 'Add second calling' : 'Add another calling'}
        </Button>
      </div>
    </DialogShell>
  );
}

const APPROVAL_SCOPE =
  'Approval applies only to this member, position and proposal. Moving them elsewhere will ask again. ' +
  'WardBoard does not certify eligibility — consult the Handbook and official records outside this app.';

export interface ApprovalEntry {
  readonly memberId: MemberId;
  readonly positionId: PositionId;
  readonly name: string;
  readonly calling: CallingLabel;
}

export interface ApprovalDialogProps {
  readonly approvals: readonly ApprovalEntry[];
  readonly proposalName: string;
  readonly recordedAs: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Artboard 4: approval of a needs-approval placement, tied to member, position and proposal. */
export function ApprovalDialog({ approvals, proposalName, recordedAs, onConfirm, onCancel }: ApprovalDialogProps): ReactElement {
  const prefix = useId();
  const titleId = `${prefix}-title`;
  const checkboxId = `${prefix}-confirm`;
  const [checked, setChecked] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);

  return (
    <DialogShell titleId={titleId} onCancel={onCancel} initialFocus={checkbox} className="wb-dnd-approval-dialog">
      <div className="wb-dnd-approval-head">
        <span className="wb-dnd-lock" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <h2 id={titleId} className="wb-dnd-dialog-title">
          Approval needed for this placement
        </h2>
      </div>
      {approvals.map((approval) => (
        <div key={`${approval.memberId}|${approval.positionId}`} className="wb-dnd-approval">
          <p className="wb-dnd-dialog-text">{`${approval.name} is marked Needs approval.`}</p>
          <dl className="wb-dnd-approval-facts">
            <dt>Member</dt>
            <dd>{approval.name}</dd>
            <dt>Calling</dt>
            <dd>{joinLabel(approval.calling)}</dd>
            <dt>Proposal</dt>
            <dd>{proposalName}</dd>
          </dl>
        </div>
      ))}
      <p className="wb-dnd-dialog-guidance">{APPROVAL_SCOPE}</p>
      <div className="wb-dnd-check">
        <input
          ref={checkbox}
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
        />
        <label htmlFor={checkboxId}>
          I&apos;ve reviewed this outside WardBoard and approve this placement for discussion.
        </label>
      </div>
      <div className="wb-dnd-dialog-foot">
        <p className="wb-dnd-dialog-note">{`Recorded as ${recordedAs} · today`}</p>
        <div className="wb-dnd-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!checked} onClick={onConfirm}>
            Approve placement
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
