import { describe, expect, it } from 'vitest';
import { buildBoard, buildProposal, buildWard, type OrgSpec } from './fixtures.ts';
import { summaryCsv, summaryFilename } from './csv.ts';

describe('summaryCsv', () => {
  it('exact rows, order, and RFC 4180 escaping for comma/quote names', () => {
    const comma = 'Ann, Alpha';
    const quoted = 'Bob "Big" Beta';
    const plain = 'Cid Plain';
    const baselineSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: [comma] },
              { title: 'Alpha Vice', type: 'single', occupants: [plain] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta Lead', type: 'single', occupants: [null] }] }],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha Chair', type: 'single', occupants: [plain] },
              { title: 'Alpha Vice', type: 'single', occupants: [comma] },
              { title: 'Ward, Committee', type: 'list', occupants: [null, null] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta Lead', type: 'single', occupants: [quoted] }] }],
      },
    ];
    const ward = buildWard([comma, quoted, plain]);
    const current = buildBoard(baselineSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baselineSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    expect(summaryCsv(proposal, current, ward)).toBe(
      [
        'Section,Who,What',
        'Suggested calling,Cid Plain,Alpha · Alpha Chair',
        'Suggested calling,"Ann, Alpha",Alpha · Alpha Vice',
        'Suggested calling,"Bob ""Big"" Beta",Beta · Beta Lead',
        'Suggested release,"Ann, Alpha",Alpha · Alpha Chair',
        'Suggested release,Cid Plain,Alpha · Alpha Vice',
        'Remaining vacancy,Alpha,"Ward, Committee"',
        'Remaining vacancy,Alpha,"Ward, Committee"',
      ].join('\n'),
    );
  });

  it('fields with commas, quotes, and newlines are double-quoted with doubled quotes', () => {
    const newlineName = 'Cara\nNewline';
    const baselineSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'single', occupants: [newlineName] },
              { title: 'Ward, Committee', type: 'list', occupants: [null] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta One', type: 'single', occupants: [null] }] }],
      },
    ];
    const proposalSpec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'single', occupants: [null] },
              { title: 'Ward, Committee', type: 'list', occupants: [null] },
            ],
          },
        ],
      },
      {
        name: 'Beta',
        groups: [{ name: 'Beta Group', assignments: [{ title: 'Beta One', type: 'single', occupants: [newlineName] }] }],
      },
    ];
    const ward = buildWard([newlineName]);
    const current = buildBoard(baselineSpec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(baselineSpec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(proposalSpec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    expect(summaryCsv(proposal, current, ward)).toBe(
      [
        'Section,Who,What',
        'Suggested calling,"Cara\nNewline",Beta · Beta One',
        'Suggested release,"Cara\nNewline",Alpha · Alpha One',
        'Remaining vacancy,Alpha,Alpha One',
        'Remaining vacancy,Alpha,"Ward, Committee"',
      ].join('\n'),
    );
  });

  it('no changes at all → header row only', () => {
    const spec: OrgSpec[] = [
      {
        name: 'Alpha',
        groups: [
          {
            name: 'Alpha Group',
            assignments: [
              { title: 'Alpha One', type: 'single', occupants: ['Ann Alpha'] },
              { title: 'Alpha Two', type: 'list', occupants: ['Bob Beta', 'Cid C'] },
            ],
          },
        ],
      },
    ];
    const ward = buildWard(['Ann Alpha', 'Bob Beta', 'Cid C']);
    const current = buildBoard(spec, { kind: 'current', id: 'b-current' }, ward);
    const baseline = buildBoard(spec, { kind: 'baseline', id: 'b-baseline' }, ward);
    const board = buildBoard(spec, { kind: 'proposal', id: 'b-board' }, ward);
    const proposal = buildProposal(baseline, board, ward);

    expect(summaryCsv(proposal, current, ward)).toBe('Section,Who,What');
  });
});

describe('summaryFilename', () => {
  it('filename sanitization: spaces kept, unsafe chars dashed, empty → summary', () => {
    expect(summaryFilename('Spring adjustments')).toBe('Spring adjustments.csv');
    expect(summaryFilename('Fall: Q4! 2026')).toBe('Fall- Q4- 2026.csv');
    expect(summaryFilename('A/B\\C:D')).toBe('A-B-C-D.csv');
    expect(summaryFilename('---')).toBe('summary.csv');
    expect(summaryFilename('')).toBe('summary.csv');
    expect(summaryFilename('Météo')).toBe('M-t-o.csv');
    expect(summaryFilename('  ')).toBe('  .csv');
  });
});
