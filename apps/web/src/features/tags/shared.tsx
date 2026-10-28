import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import type { TagId, Ward } from '@wardboard/core';
import type { RequestResult } from '../../sync/protocol.ts';
import { tagSuggestions } from './tag-model.ts';
import './tags.css';

export type Outcome = RequestResult<object>;

/**
 * Runs one callback at a time. While it is pending `pending` is true so the
 * caller can disable its controls; a refusal is kept in `error` (shown in a
 * `role="alert"` element) until the next run.
 */
export function useAction(): {
  pending: boolean;
  error: string | null;
  run: (fn: () => Promise<Outcome>) => Promise<boolean>;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<Outcome>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      return true;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, run };
}

export function ErrorLine({ message }: { message: string | null }): ReactElement | null {
  if (message === null) {
    return null;
  }
  return (
    <p className="wb-tags-error" role="alert">
      {message}
    </p>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function TagChip({
  name,
  removeLabel,
  tone = 'plain',
  onRemove,
  disabled = false,
}: {
  name: string;
  /** Accessible name of the remove button; null renders a read-only chip. */
  removeLabel: string | null;
  tone?: 'plain' | 'accent';
  onRemove?: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <span className={`wb-tags-chip wb-tags-chip-${tone}${removeLabel === null ? ' wb-tags-chip-static' : ''}`}>
      <span className="wb-tags-chip-name">{name}</span>
      {removeLabel === null ? null : (
        <button type="button" className="wb-tags-chip-remove" aria-label={removeLabel} disabled={disabled} onClick={onRemove}>
          <CloseIcon />
        </button>
      )}
    </span>
  );
}

export function peopleCount(n: number): string {
  return `${String(n)} ${n === 1 ? 'person' : 'people'}`;
}

type Option = { kind: 'tag'; id: TagId; name: string; members: number } | { kind: 'create'; name: string };

/**
 * Combobox over the ward's tags: type to filter, ArrowUp/ArrowDown to move,
 * Enter or click to pick, Escape to close. A create option is offered only
 * when `onCreate` is given and the typed name is new.
 */
export function TagCombobox({
  ward,
  carried,
  label,
  disabled = false,
  autoFocus = false,
  onPick,
  onCreate,
  onDismiss,
}: {
  ward: Ward;
  carried: readonly TagId[];
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onPick: (id: TagId) => void;
  onCreate?: (name: string) => void;
  /** Called on Escape and on blur, so a transient picker can put itself away. */
  onDismiss?: () => void;
}): ReactElement {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const { suggestions, create } = tagSuggestions(ward, carried, query);
  const options: Option[] = suggestions.map((s) => ({ kind: 'tag', id: s.id, name: s.name, members: s.members }));
  if (onCreate !== undefined && create !== null) {
    options.push({ kind: 'create', name: create });
  }
  const showList = open && options.length > 0;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  // A transient picker opened by a user action takes focus when it appears.
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!disabled && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [disabled]);

  const choose = (option: Option): void => {
    refocus.current = true;
    setQuery('');
    setOpen(false);
    setActive(0);
    if (option.kind === 'tag') {
      onPick(option.id);
    } else {
      onCreate?.(option.name);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!showList) {
        setOpen(true);
        setActive(0);
      } else {
        setActive(Math.min(activeIndex + 1, options.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      const option = options[activeIndex];
      if (showList && option !== undefined) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      onDismiss?.();
    }
  };

  const optionId = (index: number): string => `${baseId}-opt-${String(index)}`;

  return (
    <div className="wb-tags-combobox" data-open={showList ? 'true' : 'false'}>
      <div className="wb-tags-combobox-field">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(activeIndex) : undefined}
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder="Add a tag"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onClick={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            onDismiss?.();
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList ? (
        <ul id={listId} role="listbox" aria-label="Tag suggestions" className="wb-tags-listbox">
          {options.map((option, index) => (
            <li
              key={option.kind === 'tag' ? option.id : 'create'}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`wb-tags-option${option.kind === 'create' ? ' wb-tags-option-create' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                choose(option);
              }}
            >
              {option.kind === 'tag' ? (
                <>
                  <span>{option.name}</span>
                  <span className="wb-tags-option-count">{peopleCount(option.members)}</span>
                </>
              ) : (
                <span>{`Create tag “${option.name}”`}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
