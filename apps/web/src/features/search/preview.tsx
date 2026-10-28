import { useState, type ReactElement } from 'react';
import type { AddToDugoutRequest } from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { SearchBox, type SearchHighlight, type SearchTarget } from './SearchBox.tsx';
import './search.css';

function append(setLines: (update: (current: readonly string[]) => readonly string[]) => void, payload: unknown): void {
  const line = JSON.stringify(payload);
  setLines((current) => [...current, line]);
}

function SearchPreview({ data }: { data: PreviewData }): ReactElement {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [readOnlyLines, setReadOnlyLines] = useState<readonly string[]>([]);
  const active = data.proposal.board;
  const boards = [active, data.current] as const;

  return (
    <div className="wb-search-preview">
      <SearchBox
        ward={data.ward}
        active={active}
        boards={boards}
        readOnly={false}
        onNavigate={(target: SearchTarget) => {
          append(setLines, target);
        }}
        onAddToDugout={(request: AddToDugoutRequest) => {
          append(setLines, request);
        }}
        onHighlight={(highlight: SearchHighlight) => {
          append(setLines, highlight);
        }}
        onClose={() => {
          append(setLines, 'close');
        }}
      />
      {lines.length === 0 ? null : <pre className="wb-search-emitted">{lines.join('\n')}</pre>}
      <section className="wb-search-preview-block">
        <h2>Read-only</h2>
        <SearchBox
          ward={data.ward}
          active={active}
          boards={boards}
          readOnly
          onNavigate={(target: SearchTarget) => {
            append(setReadOnlyLines, target);
          }}
          onAddToDugout={(request: AddToDugoutRequest) => {
            append(setReadOnlyLines, request);
          }}
          onHighlight={(highlight: SearchHighlight) => {
            append(setReadOnlyLines, highlight);
          }}
          onClose={() => {
            append(setReadOnlyLines, 'close');
          }}
        />
        {readOnlyLines.length === 0 ? null : <pre className="wb-search-emitted">{readOnlyLines.join('\n')}</pre>}
      </section>
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Search',
  render: (data) => <SearchPreview data={data} />,
};

export default preview;
