import { describe, expect, it } from 'vitest';
import { buildFixtureWard } from '../../src/fixtures/index.ts';
import { search, type MemberId, type Ward } from '../../src/index.ts';

function peopleNames(ward: Ward, people: readonly { memberId: MemberId }[]): string[] {
  return people.map((person) => {
    const member = ward.members[person.memberId];
    if (member === undefined) {
      throw new Error(`missing member ${person.memberId}`);
    }
    return member.name;
  });
}

describe('no-calling filter and outside callings', () => {
  it('no-calling filter excludes members with outside callings', () => {
    const { ward, current } = buildFixtureWard();
    const names = peopleNames(
      ward,
      search({ query: '', boards: [current], filters: { noCalling: true } }, ward).people,
    );

    expect(names).toContain('Ivy Notreal');
    expect(names).toContain('Jay Storybook');
    expect(names).not.toContain('Kai Fictional');
    expect(names).not.toContain('Hal Testwell');
  });
});
