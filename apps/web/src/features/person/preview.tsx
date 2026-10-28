import { useState, type ReactElement } from 'react';
import { addToDugout, callingsOf, sequentialIds, type Member, type MemberId, type Ward } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { NotesDialog } from './NotesDialog.tsx';
import { PersonInspector } from './PersonInspector.tsx';
import './person.css';

function joTestwell(data: PreviewData): Member {
  // Jo Testwell holds Relief Society Teacher and Nursery Leader.
  const found = Object.values(data.ward.members).find((member) => member.name === 'Jo Testwell');
  if (found === undefined) {
    throw new Error('Jo Testwell is not in the preview ward');
  }
  if (callingsOf(data.proposal.board, found.id).length !== 2) {
    throw new Error('Jo Testwell does not hold two callings');
  }
  return found;
}

function withNote(ward: Ward, id: MemberId, note: string | null): Ward {
  const member = ward.members[id];
  if (member === undefined) {
    throw new Error(`member ${id} is not in the ward`);
  }
  return {
    members: { ...ward.members, [id]: { ...member, note } },
    tags: ward.tags,
  };
}

function PersonPreview({ data }: { readonly data: PreviewData }): ReactElement {
  // getPreviewData caches this ward and board. Replace state; do not mutate them.
  const [ward, setWard] = useState(data.ward);
  const [board, setBoard] = useState(data.proposal.board);
  const [notesOpen, setNotesOpen] = useState(false);
  const jo = joTestwell(data);
  const member = ward.members[jo.id];
  if (member === undefined) {
    throw new Error('Jo Testwell is not in the local ward');
  }

  return (
    <div className="wb-person-preview">
      <PersonInspector
        board={board}
        ward={ward}
        memberId={jo.id}
        readOnly={false}
        onOpenNotes={() => {
          setNotesOpen(true);
        }}
        onAddToDugout={(id) => {
          const result = addToDugout(board, { ward, ids: sequentialIds('person') }, { memberId: id });
          if (!result.ok) {
            throw new Error(result.error.message);
          }
          setBoard(result.board);
        }}
      />
      {notesOpen ? (
        <NotesDialog
          member={member}
          onSave={(id, note) => {
            setWard((current) => withNote(current, id, note));
            return Promise.resolve({ ok: true });
          }}
          onClose={() => {
            setNotesOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Person',
  render: (data) => <PersonPreview data={data} />,
};

export default preview;
