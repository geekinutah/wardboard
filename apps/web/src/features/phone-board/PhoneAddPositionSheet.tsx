import { useEffect, useId, useState, type ReactElement, type SubmitEvent } from 'react';
import {
  callingGroupId,
  classifyCallingGender,
  type AddAssignmentRequest,
  type AssignmentType,
  type CallingGenderRule,
} from '@wardboard/core';
import './phone-board.css';

export interface PhoneAddPositionSheetProps {
  readonly callingGroupName: string;
  readonly organizationName: string;
  readonly groupId: string;
  readonly onSubmit: (request: AddAssignmentRequest) => void;
  readonly onClose: () => void;
}

const MIN_LIST_POSITIONS = 1;
const MAX_LIST_POSITIONS = 50;
const DEFAULT_LIST_POSITIONS = 2;

function clampCount(value: number): number {
  if (!Number.isInteger(value) || value < MIN_LIST_POSITIONS) return MIN_LIST_POSITIONS;
  if (value > MAX_LIST_POSITIONS) return MAX_LIST_POSITIONS;
  return value;
}

function parseGenderRule(value: string): CallingGenderRule {
  if (value === 'M' || value === 'F' || value === 'any' || value === 'presidency_aligned') return value;
  return 'any';
}

function helperText(count: number): string {
  return `Adds ${String(count)} vacant position(s) to this proposal only. Current and other proposals are unchanged.`;
}

/**
 * The Handbook default, unless the editor picked something else.
 * `presidency_aligned` is only offered for Sunday School presidency titles, so a
 * leftover choice drops back to the new Handbook result instead of being submitted hidden.
 */
function shownGender(touched: boolean, choice: CallingGenderRule, handbook: CallingGenderRule): CallingGenderRule {
  const selected = touched ? choice : handbook;
  if (selected === 'presidency_aligned' && handbook !== 'presidency_aligned') return handbook;
  return selected;
}

/** Phone bottom sheet for one new calling on the open Draft. */
export function PhoneAddPositionSheet({
  callingGroupName,
  organizationName,
  groupId,
  onSubmit,
  onClose,
}: PhoneAddPositionSheetProps): ReactElement {
  const titleId = useId();
  const formId = useId();
  const countId = useId();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssignmentType>('single');
  const [count, setCount] = useState(DEFAULT_LIST_POSITIONS);
  const [genderTouched, setGenderTouched] = useState(false);
  const [genderChoice, setGenderChoice] = useState<CallingGenderRule>('any');
  const [error, setError] = useState('');
  const handbook = classifyCallingGender(organizationName, title.trim());
  const genderRule = shownGender(genderTouched, genderChoice, handbook);
  const shownCount = type === 'single' ? 1 : count;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Enter a calling title');
      return;
    }
    onSubmit({
      groupId: callingGroupId(groupId),
      title: trimmed,
      type,
      positionCount: type === 'single' ? 1 : clampCount(count),
      genderRule,
    });
  }

  return (
    <>
      <div className="wb-phone-sheet-scrim wb-phone-add-scrim" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="wb-phone-sheet-dialog wb-phone-add">
        <span className="wb-phone-sheet-handle" aria-hidden="true" />
        <h2 id={titleId} className="wb-phone-add-title">{`Add a position to ${callingGroupName}`}</h2>
        <form className="wb-phone-add-form" onSubmit={submit}>
          <label className="wb-phone-add-field">
            Calling title
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError('');
              }}
            />
          </label>
          <label className="wb-phone-add-field">
            Gender requirement
            <select
              aria-label="Gender requirement"
              value={genderRule}
              onChange={(event) => {
                setGenderTouched(true);
                setGenderChoice(parseGenderRule(event.target.value));
              }}
            >
              <option value="any">Any</option>
              <option value="M">Men only</option>
              <option value="F">Women only</option>
              {handbook === 'presidency_aligned' ? <option value="presidency_aligned">Same as presidency</option> : null}
            </select>
          </label>
          <fieldset className="wb-phone-add-fieldset">
            <legend>Type</legend>
            <div className="wb-phone-add-choices">
              <label className="wb-phone-add-choice">
                <input
                  type="radio"
                  name={`${formId}-type`}
                  value="single"
                  checked={type === 'single'}
                  onChange={() => {
                    setType('single');
                  }}
                />
                Single person
              </label>
              <label className="wb-phone-add-choice">
                <input
                  type="radio"
                  name={`${formId}-type`}
                  value="list"
                  checked={type === 'list'}
                  onChange={() => {
                    setType('list');
                  }}
                />
                List
              </label>
            </div>
          </fieldset>
          {type === 'list' ? (
            <div className="wb-phone-add-stepper-field">
              <label htmlFor={countId}>Positions</label>
              <div className="wb-phone-add-stepper">
                <button
                  type="button"
                  aria-label="Fewer positions"
                  onClick={() => {
                    setCount((current) => clampCount(current - 1));
                  }}
                >
                  −
                </button>
                <input
                  id={countId}
                  className="wb-phone-add-count"
                  type="number"
                  min={MIN_LIST_POSITIONS}
                  max={MAX_LIST_POSITIONS}
                  value={count}
                  onChange={(event) => {
                    setCount(clampCount(Number.parseInt(event.target.value, 10)));
                  }}
                />
                <button
                  type="button"
                  aria-label="More positions"
                  onClick={() => {
                    setCount((current) => clampCount(current + 1));
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}
          <p className="wb-phone-add-help">{helperText(shownCount)}</p>
          {error === '' ? null : (
            <p className="wb-phone-add-error" role="alert">
              {error}
            </p>
          )}
          <div className="wb-phone-add-actions">
            <button type="button" className="wb-phone-add-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="wb-phone-add-submit">
              Add position
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
