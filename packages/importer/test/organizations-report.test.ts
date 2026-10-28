import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  extractPdf,
  parseOrganizationsReport,
  OrganizationsReportError,
  type PdfDocument,
} from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function cloneDoc(doc: PdfDocument): PdfDocument {
  return structuredClone(doc);
}

function withPageRows(doc: PdfDocument, pageIndex: number, rows: readonly import('../src/index.ts').PdfRow[]): PdfDocument {
  return {
    ...doc,
    pages: doc.pages.map((p, idx) => (idx === pageIndex ? { ...p, rows } : p)),
  };
}

const orgsPdf = extractPdf(loadFixture('organizations-and-callings.pdf'));
const withoutCallingsPdf = extractPdf(loadFixture('members-without-callings.pdf'));

describe('T-053: Organizations and Callings parser', () => {
  it('reads unit name and report date without the unit number', () => {
    const report = parseOrganizationsReport(orgsPdf);
    assert.equal(report.kind, 'organizations');
    assert.equal(report.unitName, 'Cedar 14th Ward');
    assert.equal(report.reportDate, '2026-10-25');
    const json = JSON.stringify(report);
    assert.ok(!json.includes('100001'), 'Must not include unit number 100001');
    assert.ok(!json.includes('200002'), 'Must not include stake unit number 200002');
  });

  it('finds the 11 organizations in document order with their group counts', () => {
    const report = parseOrganizationsReport(orgsPdf);
    const expectedNames = [
      'Bishopric',
      'Elders Quorum',
      'Relief Society',
      'Aaronic Priesthood Quorums',
      'Young Women',
      'Sunday School',
      'Primary',
      'Ward Missionaries',
      'Temple and Family History',
      'Young Single Adult',
      'Other Callings',
    ];
    const expectedGroupCounts = [1, 5, 5, 8, 8, 11, 10, 1, 1, 1, 7];

    assert.equal(report.organizations.length, 11);
    assert.deepEqual(
      report.organizations.map((o) => o.name),
      expectedNames,
    );
    assert.deepEqual(
      report.organizations.map((o) => o.groups.length),
      expectedGroupCounts,
    );
    const totalGroups = report.organizations.reduce((acc, o) => acc + o.groups.length, 0);
    assert.equal(totalGroups, 58);
  });

  it('reconciles 244 positions, 95 vacant, 31 custom across all calling tables', () => {
    const report = parseOrganizationsReport(orgsPdf);
    const expectedPositionsPerOrg = [9, 17, 24, 31, 39, 25, 33, 5, 15, 4, 42];
    const expectedVacantPerOrg = [1, 6, 5, 9, 21, 5, 10, 1, 6, 2, 29];

    const actualPositionsPerOrg = report.organizations.map((o) =>
      o.groups.reduce((acc, g) => acc + g.positions.length, 0),
    );
    const actualVacantPerOrg = report.organizations.map((o) =>
      o.groups.reduce((acc, g) => acc + g.positions.filter((p) => p.occupant === null).length, 0),
    );

    assert.deepEqual(actualPositionsPerOrg, expectedPositionsPerOrg);
    assert.deepEqual(actualVacantPerOrg, expectedVacantPerOrg);

    const totalPositions = actualPositionsPerOrg.reduce((acc, n) => acc + n, 0);
    const totalVacant = actualVacantPerOrg.reduce((acc, n) => acc + n, 0);
    const totalOccupied = totalPositions - totalVacant;

    assert.equal(totalPositions, 244);
    assert.equal(totalVacant, 95);
    assert.equal(totalOccupied, 149);

    const distinctOccupants = new Set<string>();
    let totalCustom = 0;
    let customVacant = 0;

    for (const org of report.organizations) {
      for (const group of org.groups) {
        for (const pos of group.positions) {
          if (pos.occupant !== null) {
            distinctOccupants.add(pos.occupant);
          }
          if (pos.custom) {
            totalCustom++;
            if (pos.occupant === null) {
              customVacant++;
            }
          }
        }
      }
    }

    assert.equal(distinctOccupants.size, 129);
    assert.equal(totalCustom, 31);
    assert.equal(customVacant, 21);

    // Bishopric details
    const bishopricOrg = report.organizations[0];
    assert.ok(bishopricOrg);
    const bishopricGroup = bishopricOrg.groups[0];
    assert.ok(bishopricGroup);
    const pos0 = bishopricGroup.positions[0];
    assert.ok(pos0);
    assert.equal(pos0.title, 'Bishop');
    assert.equal(pos0.occupant, 'Stanley, Zed');
    const pos1 = bishopricGroup.positions[1];
    assert.ok(pos1);
    assert.equal(pos1.title, 'Bishopric First Counselor');
    assert.equal(pos1.occupant, 'Holwood, Wade');
    const pos2 = bishopricGroup.positions[2];
    assert.ok(pos2);
    assert.equal(pos2.title, 'Bishopric Second Counselor');
    assert.equal(pos2.occupant, 'Marwell, Jonah');
    const pos5 = bishopricGroup.positions[5];
    assert.ok(pos5);
    assert.equal(pos5.title, 'Ward Assistant Executive Secretary');
    assert.equal(pos5.occupant, null);

    // Elders Quorum groups
    const eqOrg = report.organizations[1];
    assert.ok(eqOrg);
    assert.deepEqual(
      eqOrg.groups.map((g) => g.name),
      ['Elders Quorum Presidency', 'Teachers', 'Ministering', 'Activities', 'Service'],
    );
  });

  it('organizations whose table follows the heading directly get one group named after the organization', () => {
    const report = parseOrganizationsReport(orgsPdf);
    const singleTableOrgNames = [
      'Bishopric',
      'Ward Missionaries',
      'Temple and Family History',
      'Young Single Adult',
    ];

    for (const orgName of singleTableOrgNames) {
      const org = report.organizations.find((o) => o.name === orgName);
      assert.ok(org, `Organization ${orgName} must exist`);
      assert.equal(org.groups.length, 1, `${orgName} must have exactly one group`);
      assert.equal(org.groups[0]?.name, orgName, `${orgName} group name must equal organization name`);
    }
  });

  it('continues a calling table across a page break without starting a new group', () => {
    const report = parseOrganizationsReport(orgsPdf);

    // Relief Society Service (heading on page 6, rows on page 7)
    const rs = report.organizations.find((o) => o.name === 'Relief Society');
    assert.ok(rs);
    const rsService = rs.groups.find((g) => g.name === 'Service');
    assert.ok(rsService);
    assert.equal(rsService.positions.length, 9);
    const rsPos0 = rsService.positions[0];
    assert.ok(rsPos0);
    assert.equal(rsPos0.title, 'Relief Society Service Coordinator');
    assert.equal(rsPos0.occupant, null);
    const rsPos1 = rsService.positions[1];
    assert.ok(rsPos1);
    assert.equal(rsPos1.title, 'Relief Society Assistant Service Coordinator');
    assert.equal(rsPos1.occupant, null);

    const rsCustomPositions = rsService.positions.filter(
      (p) => p.title === 'Relief Society Compassionate Service Committee',
    );
    assert.equal(rsCustomPositions.length, 5);
    for (const p of rsCustomPositions) {
      assert.equal(p.custom, true);
    }
    const rsCustomOccupied = rsCustomPositions.filter((p) => p.occupant !== null);
    const rsCustomVacant = rsCustomPositions.filter((p) => p.occupant === null);
    assert.equal(rsCustomOccupied.length, 4);
    assert.equal(rsCustomVacant.length, 1);

    // Sunday School Away on Missions (Count on page 12)
    const ss = report.organizations.find((o) => o.name === 'Sunday School');
    assert.ok(ss);
    const ssAway = ss.groups.find((g) => g.name === 'Away on Missions');
    assert.ok(ssAway);
    assert.equal(ssAway.positions.length, 1);
    const ssPos0 = ssAway.positions[0];
    assert.ok(ssPos0);
    assert.equal(ssPos0.title, 'Sunday School Teacher');
    assert.equal(ssPos0.occupant, 'Harfield, Kade');
  });

  it('strips the custom marker and keeps long titles whole', () => {
    const report = parseOrganizationsReport(orgsPdf);

    const tfh = report.organizations.find((o) => o.name === 'Temple and Family History');
    assert.ok(tfh);
    const tfhGroup = tfh.groups[0];
    assert.ok(tfhGroup);
    const templePrep = tfhGroup.positions.find((p) => p.title === 'Temple Prep Instructor');
    assert.ok(templePrep, 'Temple Prep Instructor position must exist');
    assert.equal(templePrep.custom, true);
    assert.ok(!templePrep.title.startsWith('*'), 'Title must have leading custom marker removed');

    const aaronic = report.organizations.find((o) => o.name === 'Aaronic Priesthood Quorums');
    assert.ok(aaronic);
    let foundCampDirector = false;
    for (const g of aaronic.groups) {
      for (const p of g.positions) {
        if (p.title === 'Aaronic Priesthood Quorums Specialist - Assistant Camp Director') {
          foundCampDirector = true;
          assert.equal(p.custom, false);
          assert.equal(p.occupant, null);
        }
      }
    }
    assert.ok(foundCampDirector, 'Long title must be preserved intact as a single position');
  });

  it('drops room numbers from class group names', () => {
    const report = parseOrganizationsReport(orgsPdf);

    const primary = report.organizations.find((o) => o.name === 'Primary');
    assert.ok(primary);
    const primaryGroupNames = primary.groups.map((g) => g.name);
    assert.ok(primaryGroupNames.includes('Valiant 10, Valiant 9'));
    assert.ok(primaryGroupNames.includes('Valiant 8'));

    for (const org of report.organizations) {
      for (const g of org.groups) {
        assert.ok(!g.name.includes('Room'), `Group name "${g.name}" must not contain "Room"`);
      }
    }
  });

  it('never emits member-roster names or personal fields', () => {
    const report = parseOrganizationsReport(orgsPdf);
    const json = JSON.stringify(report);

    const forbiddenStrings = [
      'Lynby, Milo',
      'Winton, Wes',
      'Fairwell, Cameron Sage Bailey Dakota Skyler',
      '@example.com',
      '555-',
      'Birth',
      '✓',
      'Jan 2024',
      '1974',
    ];

    for (const forbidden of forbiddenStrings) {
      assert.ok(
        !json.includes(forbidden),
        `JSON output must not contain forbidden personal field: "${forbidden}"`,
      );
    }

    // Every string in positions must be a valid title or occupant
    for (const org of report.organizations) {
      assert.ok(org.name.length > 0);
      for (const group of org.groups) {
        assert.ok(group.name.length > 0);
        for (const pos of group.positions) {
          assert.ok(pos.title.length > 0);
          if (pos.occupant !== null) {
            assert.ok(pos.occupant.includes(','), `Occupant "${pos.occupant}" must be "Last, First Middle" format`);
          }
        }
      }
    }
  });

  it('rejects a different report as WRONG_REPORT', () => {
    assert.throws(
      () => parseOrganizationsReport(withoutCallingsPdf),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'WRONG_REPORT');
        assert.equal(err.page, 1);
        return true;
      },
    );

    const alteredDoc = cloneDoc(orgsPdf);
    (alteredDoc as { title: string | null }).title = 'Something else';
    assert.throws(
      () => parseOrganizationsReport(alteredDoc),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'WRONG_REPORT');
        assert.equal(err.page, 1);
        return true;
      },
    );
  });

  it('throws COUNT_MISMATCH when a calling row is missing', () => {
    const p1 = orgsPdf.pages[0];
    assert.ok(p1);

    // Remove the Bishop row from page 1
    const bishopIdx = p1.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Bishop' && !it.bold),
    );
    assert.ok(bishopIdx !== -1, 'Bishop row must be found on page 1');
    const newRows = [...p1.rows];
    newRows.splice(bishopIdx, 1);
    const doc = withPageRows(orgsPdf, 0, newRows);

    assert.throws(
      () => parseOrganizationsReport(doc),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'COUNT_MISMATCH');
        assert.equal(err.page, 1);
        assert.ok(err.message.includes('Bishopric'), 'Error message must mention the group name Bishopric');
        assert.ok(!err.message.includes('Stanley'), 'Error message must not contain member name');
        return true;
      },
    );
  });

  it('throws COUNT_MISMATCH when a roster row is missing', () => {
    const p1 = orgsPdf.pages[0];
    assert.ok(p1);

    // Remove one roster row from the Elders Quorum Members table (e.g. Kelley, Ben)
    const kelleyIdx = p1.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Kelley, Ben'),
    );
    assert.ok(kelleyIdx !== -1, 'Kelley, Ben roster row must be found on page 1');
    const newRows = [...p1.rows];
    newRows.splice(kelleyIdx, 1);
    const doc = withPageRows(orgsPdf, 0, newRows);

    assert.throws(
      () => parseOrganizationsReport(doc),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'COUNT_MISMATCH');
        return true;
      },
    );
  });

  it('throws UNRECOGNIZED_LAYOUT for an unclosed table and for a data row outside any table', () => {
    // (a) Remove the Count: 9 row on page 1
    const p1A = orgsPdf.pages[0];
    assert.ok(p1A);
    const countIdx = p1A.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Count: 9'),
    );
    assert.ok(countIdx !== -1, 'Count: 9 row must be found on page 1');
    const rowsA = [...p1A.rows];
    rowsA.splice(countIdx, 1);
    const docA = withPageRows(orgsPdf, 0, rowsA);

    assert.throws(
      () => parseOrganizationsReport(docA),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        assert.equal(err.page, 1);
        return true;
      },
    );

    // (b) Insert a two-item data row before the first heading
    const p1B = orgsPdf.pages[0];
    assert.ok(p1B);
    const bishopricHeadingIdx = p1B.rows.findIndex((r) =>
      r.items.some((it) => it.text === 'Bishopric' && !it.bold),
    );
    assert.ok(bishopricHeadingIdx !== -1, 'Bishopric heading must be found on page 1');
    const rowsB = [...p1B.rows];
    rowsB.splice(bishopricHeadingIdx, 0, {
      y: 40,
      items: [
        {
          text: 'Unexpected Title',
          x: 35.25,
          y: 40,
          fontSize: 10,
          fontName: 'LiberationSans',
          bold: false,
          italic: false,
        },
        {
          text: 'Unexpected Occupant',
          x: 200,
          y: 40,
          fontSize: 10,
          fontName: 'LiberationSans',
          bold: false,
          italic: false,
        },
      ],
    });
    const docB = withPageRows(orgsPdf, 0, rowsB);

    assert.throws(
      () => parseOrganizationsReport(docB),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationsReportError);
        assert.equal(err.code, 'UNRECOGNIZED_LAYOUT');
        assert.equal(err.page, 1);
        return true;
      },
    );
  });

  it('is deterministic', () => {
    const report1 = parseOrganizationsReport(orgsPdf);
    const report2 = parseOrganizationsReport(orgsPdf);
    assert.deepEqual(report1, report2);
  });
});
