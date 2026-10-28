import { useState, type ReactElement } from 'react';
import type { SetOversightRequest } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { AaronicView } from './AaronicView.tsx';
import './aaronic.css';

function AaronicPreview({ data }: { data: PreviewData }): ReactElement {
  const [emitted, setEmitted] = useState<readonly string[]>([]);
  const group = Object.values(data.proposal.board.boardGroups).find((item) => item.key === 'aaronic_priesthood');
  if (group === undefined) {
    throw new Error('preview board group aaronic_priesthood not found');
  }

  function record(request: SetOversightRequest): void {
    setEmitted((current) => [...current, JSON.stringify(request)]);
  }

  return (
    <div className="wb-aaronic-preview">
      <AaronicView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={group.id}
        readOnly={false}
        onSetOversight={record}
      />
      {emitted.length === 0 ? null : <pre className="wb-aaronic-emitted">{emitted.join('\n')}</pre>}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Aaronic Priesthood',
  render: (data) => <AaronicPreview data={data} />,
};

export default preview;
