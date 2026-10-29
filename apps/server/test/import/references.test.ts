import { describe, expect, it } from 'vitest';
import { bishopricReference } from '../../src/import/references.ts';

describe('bishopric reference rows', () => {
  it('recognizes the Aaronic bishopric rows', () => {
    const organization = 'Aaronic Priesthood Quorums';
    const group = 'Presidency of the Aaronic Priesthood';
    expect(bishopricReference(organization, group, 'Bishop')).toBe('bishop');
    expect(bishopricReference(organization, group, 'Bishopric First Counselor')).toBe('first_counselor');
    expect(bishopricReference(organization, group, 'Bishopric Second Counselor')).toBe('second_counselor');
    expect(bishopricReference('  aaronic   priesthood QUORUMS ', 'presidency  of the aaronic priesthood', 'BISHOP')).toBe(
      'bishop',
    );
  });

  it('recognizes the priests quorum president as the bishop', () => {
    expect(
      bishopricReference('Aaronic Priesthood Quorums', 'Priests Quorum Presidency', 'Priests Quorum President'),
    ).toBe('bishop');
    expect(bishopricReference('Aaronic Priesthood Quorums', 'Some Other Group', '  priests   quorum president ')).toBe(
      'bishop',
    );
  });

  it('ignores the real Bishopric and other rows', () => {
    expect(bishopricReference('Bishopric', 'Bishopric', 'Bishop')).toBeNull();
    expect(bishopricReference('Bishopric', 'Bishopric', 'Bishopric First Counselor')).toBeNull();
    expect(bishopricReference('Bishopric', 'Bishopric', 'Bishopric Second Counselor')).toBeNull();
    expect(bishopricReference('Bishopric', 'Presidency of the Aaronic Priesthood', 'Bishop')).toBeNull();
    expect(
      bishopricReference('Aaronic Priesthood Quorums', 'Priests Quorum Presidency', 'Priests Quorum First Assistant'),
    ).toBeNull();
    expect(
      bishopricReference('Aaronic Priesthood Quorums', 'Teachers Quorum Presidency', 'Teachers Quorum President'),
    ).toBeNull();
    expect(bishopricReference('Aaronic Priesthood Quorums', 'Priests Quorum Presidency', 'Bishop')).toBeNull();
    expect(bishopricReference('Elders Quorum', 'Presidency of the Aaronic Priesthood', 'Bishop')).toBeNull();
    expect(bishopricReference('Elders Quorum', 'Elders Quorum Presidency', 'Priests Quorum President')).toBeNull();
    expect(bishopricReference('Relief Society', 'Relief Society Presidency', 'Bishopric First Counselor')).toBeNull();
    expect(bishopricReference('Young Women', 'Class Presidency', 'Bishopric Second Counselor')).toBeNull();
  });
});
