import type { ReactElement } from 'react';
import { cx } from './cx.ts';
import { displayName } from './person.ts';
import { PersonContent } from './PersonContent.tsx';
import './components.css';

export type RemovedKind = 'member' | 'position';

export type RemovedCardProps = {
  name: string;
  kind?: RemovedKind | undefined;
  callingTitle?: string | undefined;
  tags?: readonly string[] | undefined;
  needsApproval?: boolean | undefined;
  proposed?: boolean | undefined;
  release?: boolean | undefined;
  className?: string | undefined;
};

export function RemovedCard({
  name,
  kind = 'member',
  callingTitle,
  tags,
  needsApproval,
  proposed,
  release,
  className,
}: RemovedCardProps): ReactElement {
  const member = kind === 'member';
  return (
    <article aria-label={displayName(name)} className={cx('wb-removed', className)}>
      <PersonContent
        name={name}
        callingTitle={callingTitle}
        tags={tags}
        needsApproval={needsApproval}
        proposed={proposed}
        release={release}
        mutedAvatar={member}
        status={member ? 'Removed from Current' : 'Position removed from Current'}
      />
      <span
        className={cx('wb-removed-watermark', member ? undefined : 'wb-removed-watermark-position')}
        aria-hidden="true"
      >
        {member ? 'REMOVED' : 'POSITION REMOVED'}
      </span>
    </article>
  );
}
