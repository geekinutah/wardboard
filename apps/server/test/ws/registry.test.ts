import { describe, expect, it } from 'vitest';
import { operationRegistry } from '../../src/ws/operations.ts';

const CONTRACT_KINDS = [
  'placeInPosition',
  'addToList',
  'swap',
  'releaseOccupant',
  'releaseCalling',
  'moveToDugout',
  'addToDugout',
  'addCallingGroup',
  'renameGroup',
  'setBoardGroupVisible',
  'moveGroup',
  'addAssignment',
  'addListPosition',
  'removePosition',
  'removeAssignment',
  'approvePlacement',
  'setCallingTags',
  'setCallingPreferences',
] as const;

describe('operation registry', () => {
  it('registry kinds equal the contract list', () => {
    expect([...Object.keys(operationRegistry)].sort()).toEqual([...CONTRACT_KINDS].sort());
  });
});
