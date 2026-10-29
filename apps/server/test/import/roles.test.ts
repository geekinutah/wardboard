import { describe, expect, it } from 'vitest';
import { classifyAssignment, classifyCallingGroup } from '../../src/import/roles.ts';

const LEADER = (leadershipRole: 'president' | 'counselor') => ({ leadershipRole, prominent: true });
const NOT_A_LEADER = { leadershipRole: null, prominent: false };

describe('import role classification', () => {
  it('classifyAssignment recognizes presidents and the bishop', () => {
    expect(classifyAssignment('Bishop')).toEqual(LEADER('president'));
    expect(classifyAssignment('  bishop ')).toEqual(LEADER('president'));
    expect(classifyAssignment('Elders Quorum President')).toEqual(LEADER('president'));
    expect(classifyAssignment('Primary President')).toEqual(LEADER('president'));
    expect(classifyAssignment('Relief Society President')).toEqual(LEADER('president'));
    expect(classifyAssignment('deacons quorum president')).toEqual(LEADER('president'));
    expect(classifyAssignment('Deacons  Quorum\tPRESIDENT ')).toEqual(LEADER('president'));
  });

  it('classifyAssignment recognizes counselors', () => {
    expect(classifyAssignment('Bishopric First Counselor')).toEqual(LEADER('counselor'));
    expect(classifyAssignment('Relief Society Second Counselor')).toEqual(LEADER('counselor'));
    expect(classifyAssignment('primary first   counselor')).toEqual(LEADER('counselor'));
  });

  it('classifyAssignment keeps executive secretaries and clerks out', () => {
    expect(classifyAssignment('Ward Executive Secretary')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Ward Assistant Executive Secretary')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Ward Clerk')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Assistant Ward Clerk--Membership')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('ward executive  secretary')).toEqual(NOT_A_LEADER);
  });

  it('classifyAssignment gives presidency secretaries the secretary role', () => {
    expect(classifyAssignment('Elders Quorum Secretary')).toEqual({ leadershipRole: 'secretary', prominent: false });
    expect(classifyAssignment('relief society secretary')).toEqual({ leadershipRole: 'secretary', prominent: false });
  });

  it('classifyAssignment leaves other callings alone', () => {
    expect(classifyAssignment('Primary Teacher')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Assistant to the Bishop in the Priests Quorum')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Assistant to the President')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Assistant President')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Sunday School Teacher')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Presidency Liaison')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Bishopric Youth Adviser')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('Priests Quorum First Assistant')).toEqual(NOT_A_LEADER);
    expect(classifyAssignment('')).toEqual(NOT_A_LEADER);
  });

  it('classifyCallingGroup', () => {
    expect(classifyCallingGroup('Bishopric')).toBe('bishopric');
    expect(classifyCallingGroup(' bishopric ')).toBe('bishopric');
    expect(classifyCallingGroup('Elders Quorum Presidency')).toBe('presidency');
    expect(classifyCallingGroup('relief  society presidency')).toBe('presidency');
    expect(classifyCallingGroup('Teachers')).toBe('other');
    expect(classifyCallingGroup('Bishopric Support')).toBe('other');
    expect(classifyCallingGroup('Presidency of the Aaronic Priesthood')).toBe('other');
    expect(classifyCallingGroup('')).toBe('other');
  });
});
