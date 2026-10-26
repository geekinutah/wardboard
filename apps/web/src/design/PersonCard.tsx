import type { ReactElement } from 'react';
import { cx } from './cx.ts';
import { displayName } from './person.ts';
import { PersonContent } from './PersonContent.tsx';
import { RemovedCard } from './RemovedCard.tsx';
import './components.css';

export type PersonCardProps = {
  name: string;
  callingTitle?: string | undefined;
  tags?: readonly string[] | undefined;
  needsApproval?: boolean | undefined;
  proposed?: boolean | undefined;
  release?: boolean | undefined;
  removed?: boolean | undefined;
  className?: string | undefined;
};

export function PersonCard({
  name,
  callingTitle,
  tags,
  needsApproval = false,
  proposed = false,
  release = false,
  removed = false,
  className,
}: PersonCardProps): ReactElement {
  if (removed) {
    return (
      <RemovedCard
        name={name}
        kind="member"
        callingTitle={callingTitle}
        tags={tags}
        needsApproval={needsApproval}
        proposed={proposed}
        release={release}
        className={className}
      />
    );
  }

  return (
    <article
      aria-label={displayName(name)}
      className={cx(
        'wb-person',
        proposed ? 'wb-person-proposed' : undefined,
        release && !proposed ? 'wb-person-release' : undefined,
        className,
      )}
    >
      <PersonContent
        name={name}
        callingTitle={callingTitle}
        tags={tags}
        needsApproval={needsApproval}
        proposed={proposed}
        release={release}
      />
    </article>
  );
}
