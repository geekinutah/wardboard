import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, vi } from 'vitest';
import type { MemberListReport, PdfDocument } from '../src/index.ts';
import { allowListMemberList, extractPdf, parseMemberList } from '../src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../fixtures/lcr-reports');

const PHONE_RE = /\(\d{3}\) 555-\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BIRTH_RE = /^\d{2} [A-Z][a-z]{2} \d{4}$/;

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, filename)));
}

function textItems(doc: PdfDocument): string[] {
  const texts: string[] = [];
  for (const page of doc.pages) {
    for (const item of page.items) texts.push(item.text);
  }
  return texts;
}

function collectMatches(texts: readonly string[], pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (value) found.add(value);
    }
  }
  return found;
}

describe('T-111: Member List allow-list', () => {
  const doc = extractPdf(loadFixture('member-list.pdf'));

  it('the allow-list keeps only name and category', () => {
    const parsed = parseMemberList(doc);
    const texts = textItems(doc);
    const phones = collectMatches(texts, PHONE_RE);
    const emails = collectMatches(texts, EMAIL_RE);
    const births = new Set(texts.filter((text) => BIRTH_RE.test(text)));
    const genders = new Set(texts.filter((text) => text === 'F' || text === 'M'));
    const ages = new Set(texts.filter((text) => /^\d{1,3}$/.test(text)));

    // Picked from the fixture text: Ashby, Ella is F, 48, 17 Nov 1977, (555) 555-0254, ella.ashby76@example.com.
    assert.equal(phones.has('(555) 555-0254'), true);
    assert.equal(emails.has('ella.ashby76@example.com'), true);
    assert.equal(births.has('17 Nov 1977'), true);
    assert.equal(genders.has('F'), true);
    assert.equal(genders.has('M'), true);
    assert.equal(ages.has('48'), true);
    assert.ok(phones.size > 10);
    assert.ok(emails.size > 10);
    assert.ok(births.size > 10);

    const tainted = structuredClone<MemberListReport>(parsed);
    const reportExtras: Record<string, string> = {
      gender: 'F',
      age: '48',
      birthDate: '17 Nov 1977',
      phone: '(555) 555-0254',
      email: 'ella.ashby76@example.com',
      'CANARY-PHONE-555-0199': 'CANARY-PHONE-555-0199',
      'CANARY-DOB-1974-01-31': 'CANARY-DOB-1974-01-31',
    };
    for (const [key, value] of Object.entries(reportExtras)) {
      Object.defineProperty(tainted, key, { value, enumerable: true, writable: true, configurable: true });
    }
    const first = tainted.entries[0];
    assert.ok(first);
    const entryExtras: Record<string, string> = {
      gender: 'F',
      age: '48',
      birthDate: '17 Nov 1977',
      phone: '(555) 555-0254',
      email: 'ella.ashby76@example.com',
      'canary.email@example.invalid': 'canary.email@example.invalid',
    };
    for (const [key, value] of Object.entries(entryExtras)) {
      Object.defineProperty(first, key, { value, enumerable: true, writable: true, configurable: true });
    }

    const logs: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => vi.spyOn(console, method));
    let cleaned: MemberListReport;
    try {
      cleaned = allowListMemberList(tainted, (line) => {
        logs.push(line);
      });
      for (const spy of spies) assert.equal(spy.mock.calls.length, 0);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    assert.equal(cleaned.kind, 'member-list');
    assert.equal(cleaned.unitName, 'Cedar 14th Ward');
    assert.equal(cleaned.reportDate, '2026-10-25');
    assert.equal(cleaned.listedCount, parsed.listedCount);
    assert.equal(cleaned.excludedUnder11, parsed.excludedUnder11);
    assert.deepEqual(
      Object.keys(cleaned).sort(),
      ['entries', 'excludedUnder11', 'kind', 'listedCount', 'reportDate', 'unitName'],
    );
    assert.equal(cleaned.entries.length, parsed.entries.length);
    assert.ok(cleaned.entries.length > 200);
    for (const entry of cleaned.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['category', 'name']);
    }
    assert.deepEqual(cleaned.entries, parsed.entries);
    assert.notEqual(cleaned, tainted);
    assert.notEqual(cleaned.entries[0], first);

    const keptName = cleaned.entries[0]?.name;
    (first as { name: string }).name = 'Changed, Name';
    assert.equal(cleaned.entries[0]?.name, keptName);

    const json = JSON.stringify(cleaned);
    const logText = logs.join('\n');
    assert.equal(json.includes('Ashby, Ella'), true);
    assert.deepEqual(logs, [`allow-list member-list entries=${String(cleaned.entries.length)}`]);

    for (const phone of phones) {
      assert.equal(json.includes(phone), false, phone);
      assert.equal(logText.includes(phone), false, phone);
    }
    for (const email of emails) {
      assert.equal(json.includes(email), false, email);
      assert.equal(logText.includes(email), false, email);
    }
    for (const birth of births) {
      assert.equal(json.includes(birth), false, birth);
      assert.equal(logText.includes(birth), false, birth);
    }
    for (const gender of genders) {
      assert.equal(json.includes(`"${gender}"`), false, gender);
      assert.equal(logText.includes(gender), false, gender);
    }
    for (const age of ages) {
      const entriesJson = JSON.stringify(cleaned.entries);
      assert.equal(new RegExp(String.raw`(?<!\d)${age}(?!\d)`).test(entriesJson), false, age);
    }
    assert.equal(json.includes('CANARY'), false);
    assert.equal(json.includes('canary.email@example.invalid'), false);
    assert.equal(logText.includes('CANARY'), false);
    assert.equal(logText.includes('Ashby'), false);
    assert.equal(logText.includes('example.com'), false);
  });
});
