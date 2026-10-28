import type { ReactElement } from 'react';
import { addToDugout, callingsOf, sequentialIds, type Board, type Ward } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { DugoutPanel } from './DugoutPanel.tsx';

/**
 * Cy Mockup already holds Primary Teacher and is not in dugoutInclusions.
 * Add him explicitly so the panel keeps that calling on the card.
 */
function boardWithCyMockup(board: Board, ward: Ward): Board {
  const cy = Object.values(ward.members).find((member) => member.name === 'Cy Mockup');
  if (cy === undefined) {
    throw new Error('Cy Mockup is not in the preview ward');
  }
  if (board.dugoutInclusions.includes(cy.id)) {
    throw new Error('Cy Mockup is already in dugoutInclusions');
  }
  if (callingsOf(board, cy.id).length === 0) {
    throw new Error('Cy Mockup does not hold a calling');
  }
  const result = addToDugout(board, { ward, ids: sequentialIds('dugout') }, { memberId: cy.id });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.board;
}

function DugoutPreview({ data }: { readonly data: PreviewData }): ReactElement {
  const board = boardWithCyMockup(data.proposal.board, data.ward);
  return (
    <div className="wb-dugout-preview">
      <DugoutPanel board={board} ward={data.ward} />
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Dugout',
  render: (data) => <DugoutPreview data={data} />,
};

export default preview;
