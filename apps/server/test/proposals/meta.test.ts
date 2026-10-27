import { describe, expect, it } from 'vitest';
import { validateMeta } from '../../src/proposals/index.ts';

const EIGHTY = 'a'.repeat(80);
const FIVE_HUNDRED = 'b'.repeat(500);

describe('proposal meta', () => {
  it('trims name, maps blank rationale to null, enforces 1–80 and ≤500', () => {
    expect(validateMeta({ name: '  Spring plan  ', rationale: '  Fill the vacancies.  ' })).toEqual({
      ok: true,
      name: 'Spring plan',
      rationale: 'Fill the vacancies.',
    });
    expect(validateMeta({ name: 'A', rationale: null })).toEqual({ ok: true, name: 'A', rationale: null });
    expect(validateMeta({ name: EIGHTY, rationale: null })).toEqual({ ok: true, name: EIGHTY, rationale: null });
    expect(validateMeta({ name: `  ${EIGHTY}  `, rationale: null })).toEqual({
      ok: true,
      name: EIGHTY,
      rationale: null,
    });
    expect(validateMeta({ name: 'Plan', rationale: FIVE_HUNDRED })).toEqual({
      ok: true,
      name: 'Plan',
      rationale: FIVE_HUNDRED,
    });
    expect(validateMeta({ name: 'Plan', rationale: `  ${FIVE_HUNDRED}  ` })).toEqual({
      ok: true,
      name: 'Plan',
      rationale: FIVE_HUNDRED,
    });
    expect(validateMeta({ name: 'Plan', rationale: '   ' })).toEqual({ ok: true, name: 'Plan', rationale: null });
    expect(validateMeta({ name: 'Plan', rationale: '' })).toEqual({ ok: true, name: 'Plan', rationale: null });

    expect(validateMeta({ name: '', rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: '   ', rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: 'a'.repeat(81), rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: `  ${'a'.repeat(81)}  `, rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: 'b'.repeat(501) })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: `  ${'b'.repeat(501)}` })).toEqual({ ok: false });
  });

  it('rejects extra/missing keys and non-string values', () => {
    expect(validateMeta({ name: 'Plan' })).toEqual({ ok: false });
    expect(validateMeta({ rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: null, note: 'extra' })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: undefined })).toEqual({ ok: false });
    expect(validateMeta({ name: 1, rationale: null })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: 1 })).toEqual({ ok: false });
    expect(validateMeta({ name: 'Plan', rationale: false })).toEqual({ ok: false });
    expect(validateMeta(null)).toEqual({ ok: false });
    expect(validateMeta(['Plan', null])).toEqual({ ok: false });
    expect(validateMeta('Plan')).toEqual({ ok: false });
    expect(validateMeta(undefined)).toEqual({ ok: false });
  });
});
