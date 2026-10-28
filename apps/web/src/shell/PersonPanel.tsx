import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { memberId, type Board, type MemberId, type Ward } from '@wardboard/core';
import { Button } from '../design/Button.tsx';
import { NotesDialog, type NoteSaveResult } from '../features/person/NotesDialog.tsx';
import { PersonInspector } from '../features/person/PersonInspector.tsx';
import { useSync, useSyncClient } from '../sync/react.tsx';

export interface PersonPanelProps {
  readonly board: Board | null;
  readonly ward: Ward | null;
  readonly readOnly: boolean;
  readonly selectedMemberId: string | null;
  readonly onClearSelection: () => void;
  readonly notesMemberId: string | null;
  readonly onOpenNotes: (memberId: string) => void;
  readonly onCloseNotes: () => void;
  readonly onSelectMember: (memberId: string) => void;
}

export function PersonPanel({
  board,
  ward,
  readOnly,
  selectedMemberId,
  onClearSelection,
  notesMemberId,
  onOpenNotes,
  onCloseNotes,
  onSelectMember,
}: PersonPanelProps): ReactElement | null {
  const client = useSyncClient();
  const { send } = useSync();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const dugout = document.getElementById('wb-editing-dugout');
    if (dugout === null) return;

    let panel = dugout.querySelector<HTMLDivElement>(':scope > .shell-person-panel');
    if (panel === null) {
      panel = document.createElement('div');
      panel.className = 'shell-person-panel';
      dugout.prepend(panel);
    }
    setContainer(panel);

    return () => {
      panel.remove();
      setContainer(null);
    };
  }, []);

  useEffect(() => {
    function findMemberId(target: EventTarget | null): string | null {
      if (!(target instanceof Element)) return null;
      const row = target.closest<HTMLElement>('.wb-dugout [data-member-id]');
      if (row === null) return null;
      return row.getAttribute('data-member-id');
    }

    function handleClick(event: MouseEvent): void {
      const id = findMemberId(event.target);
      if (id !== null) {
        onSelectMember(id);
      }
    }

    function handleDoubleClick(event: MouseEvent): void {
      const id = findMemberId(event.target);
      if (id !== null) {
        onOpenNotes(id);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (notesMemberId !== null) {
          // Dialog handles its own escape
          return;
        }
        if (selectedMemberId !== null) {
          onClearSelection();
        }
      }
    }

    document.addEventListener('click', handleClick);
    document.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [notesMemberId, selectedMemberId, onSelectMember, onOpenNotes, onClearSelection]);

  const notesMember =
    notesMemberId !== null && ward !== null
      ? ward.members[memberId(notesMemberId)]
      : undefined;

  const onSaveNote = useCallback(
    async (id: string, noteText: string | null): Promise<NoteSaveResult> => {
      const res = await client.updateMember(id, { note: noteText });
      if (res.ok) return { ok: true };
      return { ok: false, message: res.message };
    },
    [client],
  );

  const notesDialogElement =
    notesMember !== undefined ? (
      <NotesDialog
        member={notesMember}
        onSave={onSaveNote}
        onClose={onCloseNotes}
      />
    ) : null;

  if (board === null || ward === null || selectedMemberId === null) {
    return notesDialogElement;
  }

  const inspectorContent = (
    <div className="shell-person-panel-inner">
      <style>{`
        .shell-person-panel {
          border-bottom: 1px solid var(--wb-line);
          background: var(--wb-surface);
        }
        .shell-person-panel .wb-person-inspector {
          border-left: 0;
          width: 100%;
          padding-top: 10px;
        }
        .shell-person-panel-bar {
          display: flex;
          justify-content: flex-end;
          padding: 12px 16px 0 16px;
        }
      `}</style>
      <div className="shell-person-panel-bar">
        <Button
          type="button"
          variant="secondary"
          onClick={onClearSelection}
          style={{ minWidth: 44, minHeight: 44 }}
        >
          Close
        </Button>
      </div>
      <PersonInspector
        board={board}
        ward={ward}
        memberId={memberId(selectedMemberId)}
        readOnly={readOnly}
        onOpenNotes={(id) => {
          onOpenNotes(id);
        }}
        onAddToDugout={(id: MemberId) => {
          void send('addToDugout', { memberId: id });
        }}
      />
    </div>
  );

  const dugout = typeof document !== 'undefined' ? document.getElementById('wb-editing-dugout') : null;

  return (
    <>
      {container !== null ? createPortal(inspectorContent, container) : dugout === null ? inspectorContent : null}
      {notesDialogElement}
    </>
  );
}
