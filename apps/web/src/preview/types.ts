import type { ReactNode } from 'react';
import type { Board, Proposal, Ward } from '@wardboard/core';

export type PreviewData = {
  ward: Ward;
  current: Board;
  proposal: Proposal;
};

export type PreviewModule = {
  title: string;
  render: (data: PreviewData) => ReactNode;
};

export type PreviewLoader = () => Promise<{ default: PreviewModule } | PreviewModule>;
export type PreviewModuleMap = Record<string, PreviewLoader | PreviewModule>;
