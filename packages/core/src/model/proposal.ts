import { validateBoard } from './board.ts';
import { deepFreeze } from './freeze.ts';
import type { Result } from './result.ts';
import { PROPOSAL_STATUSES, type Board, type BoardKind, type Proposal, type ProposalInput, type Ward } from './types.ts';
import {
  ErrorCollector,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegativeInteger,
  isObject,
  isOneOf,
  trimmed,
} from './validate.ts';

function validateNestedBoard(
  input: Board,
  expectedKind: BoardKind,
  field: 'baseline' | 'board',
  ward: Ward,
  errors: ErrorCollector,
): Board {
  const value: unknown = input;
  if (!isObject(value)) {
    errors.add('invalid_field', field, `${field} must be a board`);
    return input;
  }
  const nested = new ErrorCollector(`${field}.`);
  const board = validateBoard(input, ward, nested);
  if (board.kind !== expectedKind) {
    nested.add('board_kind', 'kind', `${field} must have kind ${expectedKind}`);
  }
  for (const error of nested.errors) {
    // A kind that is not a board kind at all is already reported as invalid_field.
    if (!(error.code === 'invalid_field' && error.path === `${field}.kind`)) {
      errors.errors.push(error);
    }
  }
  return board;
}

function validateAcceptance(proposal: Proposal, errors: ErrorCollector): void {
  const accepted: unknown = proposal.accepted;
  if (proposal.status === 'accepted') {
    if (!isObject(accepted) || proposal.accepted === null) {
      errors.add('invalid_field', 'accepted', 'an accepted proposal must record who accepted it, when, and its summary');
      return;
    }
    if (!isNonEmptyString(proposal.accepted.by)) {
      errors.add('invalid_field', 'accepted.by', 'accepted.by must be a non-empty user id');
    }
    if (!isIsoTimestamp(proposal.accepted.at)) {
      errors.add('invalid_field', 'accepted.at', 'accepted.at must be an ISO timestamp');
    }
    const summary: unknown = proposal.accepted.summary;
    if (typeof summary !== 'string') {
      errors.add('invalid_field', 'accepted.summary', 'accepted.summary must be a string');
    }
  } else if (accepted !== null) {
    errors.add('invalid_field', 'accepted', 'a draft proposal must not have acceptance details');
  }
}

/**
 * Validates a proposal (its own fields, acceptance invariant, and both boards)
 * and returns a deeply frozen, normalized copy. Board errors are prefixed
 * `baseline.` / `board.`. Collects every error rather than stopping at the first.
 */
export function createProposal(input: ProposalInput, ward: Ward): Result<Proposal> {
  const errors = new ErrorCollector();
  const acceptedInput: unknown = input.accepted;

  if (!isNonEmptyString(input.id)) {
    errors.add('invalid_field', 'id', 'proposal id must be a non-empty string');
  }
  const name = trimmed(input.name);
  if (!isNonEmptyString(name)) {
    errors.add('invalid_field', 'name', 'proposal name must not be empty');
  }
  const rationale: unknown = input.rationale;
  if (rationale !== null && typeof rationale !== 'string') {
    errors.add('invalid_field', 'rationale', 'rationale must be null or a string');
  }
  if (!isOneOf(PROPOSAL_STATUSES, input.status)) {
    errors.add('invalid_field', 'status', `status must be one of ${PROPOSAL_STATUSES.join(', ')}`);
  }
  if (!isNonNegativeInteger(input.tabOrder)) {
    errors.add('invalid_field', 'tabOrder', 'tabOrder must be a non-negative integer');
  }
  if (!isIsoTimestamp(input.createdAt)) {
    errors.add('invalid_field', 'createdAt', 'createdAt must be an ISO timestamp');
  }
  if (!isIsoTimestamp(input.updatedAt)) {
    errors.add('invalid_field', 'updatedAt', 'updatedAt must be an ISO timestamp');
  }

  const proposal: Proposal = {
    id: input.id,
    name,
    rationale: input.rationale,
    status: input.status,
    accepted: isObject(acceptedInput) && input.accepted !== null ? { ...input.accepted } : input.accepted,
    baseline: validateNestedBoard(input.baseline, 'baseline', 'baseline', ward, errors),
    board: validateNestedBoard(input.board, 'proposal', 'board', ward, errors),
    tabOrder: input.tabOrder,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
  validateAcceptance(proposal, errors);

  if (errors.errors.length > 0) {
    return { ok: false, errors: errors.errors };
  }
  return { ok: true, value: deepFreeze(proposal) };
}
