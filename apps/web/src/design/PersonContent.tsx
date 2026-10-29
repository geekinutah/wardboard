import { useState, type ReactElement, type ReactNode } from 'react';
import { Chip } from './Chip.tsx';
import { cx } from './cx.ts';
import { avatarColor, displayName, initials } from './person.ts';

const releaseMark = '\u2212';

export type PortraitProps = {
  url: string | null | undefined;
  className: string;
  children: ReactNode;
};

/**
 * A decorative portrait in place of an avatar. Renders the fallback (the
 * initials avatar) when there is no URL or the image failed to load. The
 * failure is remembered per URL, so a different URL tries again.
 */
export function Portrait({ url, className, children }: PortraitProps): ReactElement {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (typeof url === 'string' && url.length > 0 && failedUrl !== url) {
    return (
      <img
        className={className}
        src={url}
        alt=""
        aria-hidden="true"
        onError={() => {
          setFailedUrl(url);
        }}
      />
    );
  }
  return <>{children}</>;
}

export type PersonContentProps = {
  name: string;
  callingTitle?: string | undefined;
  tags?: readonly string[] | undefined;
  needsApproval?: boolean | undefined;
  proposed?: boolean | undefined;
  release?: boolean | undefined;
  mutedAvatar?: boolean | undefined;
  status?: string | undefined;
  photoUrl?: string | null | undefined;
};

export function PersonContent({
  name,
  callingTitle,
  tags,
  needsApproval = false,
  proposed = false,
  release = false,
  mutedAvatar = false,
  status,
  photoUrl = null,
}: PersonContentProps): ReactElement {
  const shownName = displayName(name);
  const title = callingTitle ?? '';
  const tagList = tags ?? [];
  return (
    <div className="wb-person-main">
      <Portrait url={mutedAvatar ? null : photoUrl} className="wb-avatar wb-avatar-photo">
        <span
          className={cx('wb-avatar', mutedAvatar ? 'wb-avatar-muted' : undefined)}
          style={mutedAvatar ? undefined : { backgroundColor: avatarColor(shownName) }}
          aria-hidden="true"
        >
          {initials(name)}
        </span>
      </Portrait>
      <div className="wb-person-body">
        <span className="wb-person-name">{shownName}</span>
        {title.length > 0 && release ? (
          <span className="wb-release-row">
            <span className="wb-release-mark">{releaseMark}</span>
            <s className="wb-calling">{title}</s>
          </span>
        ) : null}
        {title.length > 0 && !release ? <span className="wb-calling">{title}</span> : null}
        {title.length === 0 && release ? <span className="wb-release-mark">{releaseMark}</span> : null}
        {proposed ? <Chip variant="proposed" label="+ Proposed" /> : null}
        {needsApproval ? <Chip variant="needs-approval" label="Needs approval" /> : null}
        {status !== undefined && status.length > 0 ? <span className="wb-removed-label">{status}</span> : null}
        {tagList.length > 0 ? (
          <ul className="wb-tags">
            {tagList.map((tag, index) => (
              <li key={`${tag}-${String(index)}`}>
                <Chip variant="tag" label={tag} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
