import { useState, type ReactElement } from 'react';
import type { AddAssignmentRequest, AddCallingGroupRequest, Board, CallingGroup } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { GroupDetail } from './GroupDetail.tsx';
import './group-view.css';

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`preview calling group ${name} not found`);
  }
  return found;
}

function GroupDetailPreview({ data }: { data: PreviewData }): ReactElement {
  const [emitted, setEmitted] = useState<readonly string[]>([]);
  const board = data.proposal.board;
  const reliefSocietyTeachers = callingGroupNamed(board, 'Relief Society Teachers');
  const primaryPresidency = callingGroupNamed(board, 'Primary Presidency');
  const gospelDoctrine = callingGroupNamed(board, 'Gospel Doctrine');

  function record(request: AddAssignmentRequest | AddCallingGroupRequest): void {
    setEmitted((current) => [...current, JSON.stringify(request)]);
  }

  return (
    <div className="wb-group-preview">
      <GroupDetail
        board={board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        callingGroupId={reliefSocietyTeachers.id}
        readOnly={false}
        onAddPosition={record}
        onAddGroup={record}
      />
      <GroupDetail
        board={board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        callingGroupId={primaryPresidency.id}
        readOnly={false}
        onAddPosition={record}
        onAddGroup={record}
      />
      <GroupDetail
        board={board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        callingGroupId={gospelDoctrine.id}
        readOnly={false}
        onAddPosition={record}
        onAddGroup={record}
      />
      <section className="wb-group-preview-block" aria-label="Read-only">
        <h2 className="wb-group-preview-label">Read-only</h2>
        <GroupDetail
          board={board}
          ward={data.ward}
          baseline={data.proposal.baseline}
          callingGroupId={primaryPresidency.id}
          readOnly
          onAddPosition={record}
          onAddGroup={record}
        />
      </section>
      {emitted.length === 0 ? null : <pre className="wb-group-emitted">{emitted.join('\n')}</pre>}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Group detail',
  render: (data) => <GroupDetailPreview data={data} />,
};

export default preview;
