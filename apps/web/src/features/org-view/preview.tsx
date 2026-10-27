import type { ReactNode } from 'react';
import type { BoardGroup } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { OrganizationView } from './OrganizationView.tsx';

function compareBoardGroups(a: BoardGroup, b: BoardGroup): number {
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  return a.id.localeCompare(b.id, 'en');
}

export function renderOrgViewPreview(data: PreviewData): ReactNode {
  const visibleGroups = Object.values(data.proposal.board.boardGroups)
    .filter((g) => g.visible)
    .sort(compareBoardGroups);

  return (
    <div className="wb-org-preview-container">
      {visibleGroups.map((group) => (
        <section key={group.id} className="wb-org-preview-item">
          <h2 className="wb-org-preview-item-title">{group.name}</h2>
          <OrganizationView
            board={data.proposal.board}
            ward={data.ward}
            baseline={data.proposal.baseline}
            boardGroupId={group.id}
          />
        </section>
      ))}
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Organization view',
  render: renderOrgViewPreview,
};

export default preview;
