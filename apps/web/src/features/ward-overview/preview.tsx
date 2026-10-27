import type { ReactElement } from 'react';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { WardOverview } from './WardOverview.tsx';

function WardOverviewPreview(data: PreviewData): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '36px', padding: '24px' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--wb-ink)' }}>
          Proposal: {data.proposal.name}
        </h2>
        <WardOverview
          board={data.proposal.board}
          ward={data.ward}
          baseline={data.proposal.baseline}
        />
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--wb-ink)' }}>
          Current
        </h2>
        <WardOverview
          board={data.current}
          ward={data.ward}
          baseline={null}
        />
      </section>
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Ward overview',
  render: WardOverviewPreview,
};

export default preview;
