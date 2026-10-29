import { canonicalName } from '@wardboard/importer';

const AARONIC_ORGANIZATION = 'aaronic priesthood quorums';
const AARONIC_PRESIDENCY = 'presidency of the aaronic priesthood';
const PRIESTS_QUORUM_PRESIDENT = 'priests quorum president';

/**
 * Aaronic report rows that refer to a Bishopric office instead of their own seat.
 * Priests Quorum President is the bishop. Titles and names match through canonicalName.
 */
export function bishopricReference(
  organization: string,
  group: string,
  title: string,
): 'bishop' | 'first_counselor' | 'second_counselor' | null {
  if (canonicalName(organization) !== AARONIC_ORGANIZATION) return null;
  const calling = canonicalName(title);
  if (calling === PRIESTS_QUORUM_PRESIDENT) return 'bishop';
  if (canonicalName(group) !== AARONIC_PRESIDENCY) return null;
  if (calling === 'bishop') return 'bishop';
  if (calling === 'bishopric first counselor') return 'first_counselor';
  if (calling === 'bishopric second counselor') return 'second_counselor';
  return null;
}
