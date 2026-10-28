import { useRef, useState, type ReactElement } from 'react';
import { addToDugout, sequentialIds, type Board, type MemberId } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { OutOfUnitTile } from './OutOfUnitTile.tsx';
import { OutOfUnitView } from './OutOfUnitView.tsx';

function OutOfUnitPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const [board, setBoard] = useState<Board>(data.proposal.board);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const handleOpen = () => {
    headingRef.current?.scrollIntoView({ behavior: 'smooth' });
    headingRef.current?.focus();
  };

  const handleAddToDugout = (memberId: MemberId) => {
    const result = addToDugout(
      board,
      { ward: data.ward, ids: sequentialIds('out-of-unit') },
      { memberId },
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    setBoard(result.board);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', padding: '24px', maxWidth: '720px' }}>
      <section style={{ maxWidth: '340px' }}>
        <OutOfUnitTile ward={data.ward} onOpen={handleOpen} />
      </section>
      <OutOfUnitView
        board={board}
        ward={data.ward}
        readOnly={false}
        onAddToDugout={handleAddToDugout}
        headingRef={headingRef}
      />
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Out-of-Unit',
  render: (data) => <OutOfUnitPreview data={data} />,
};

export default preview;
