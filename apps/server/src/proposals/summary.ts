import { acceptedSummary, type Proposal, type Ward } from '@wardboard/core';

/** Serialized `SummaryGroup[]`, including the names current at acceptance. */
export function freezeSummary(proposal: Proposal, ward: Ward): string {
  return JSON.stringify(acceptedSummary(proposal, ward));
}
