import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const readmePath = join(root, 'docs', 'agents', 'README.md');

/**
 * Return the body of the section whose heading line is exactly `heading`,
 * bounded by the next heading of the same or higher level. Throws a clear
 * error if the section is missing. Tolerates CRLF line endings.
 */
export function extractSection(text, heading) {
  const lines = text.split(/\r?\n/);
  const target = heading.trimEnd();
  const start = lines.findIndex((line) => line.trimEnd() === target);
  assert.notEqual(start, -1, `section not found: ${heading}`);
  const level = target.match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

const readmeText = () => readFileSync(readmePath, 'utf8');
const antigravitySection = () => extractSection(readmeText(), '## Google Antigravity');
const modelChoiceSection = () => extractSection(readmeText(), '### Model choice (Google Antigravity)');

describe('antigravity model choice', () => {
  it('extractor handles bounded sections, missing headings, and CRLF', () => {
    const sample = '# Top\n\n## Google Antigravity\nbody\n### Sub\nsub body\n## Other harnesses\nother\n';
    const body = extractSection(sample, '## Google Antigravity');
    assert.match(body, /body/);
    assert.match(body, /sub body/);
    assert.doesNotMatch(body, /Other harnesses/);
    assert.doesNotMatch(body, /other/);

    // Bounded section check on README itself:
    assert.doesNotMatch(antigravitySection(), /## Other harnesses/);

    // Missing heading fails with clear error:
    assert.throws(() => extractSection(sample, '## Missing'), /section not found: ## Missing/);

    // CRLF line endings tolerated:
    const crlfSample = '# Top\r\n\r\n## Google Antigravity\r\nbody\r\n### Sub\r\nsub body\r\n## Other harnesses\r\nother\r\n';
    const crlfBody = extractSection(crlfSample, '## Google Antigravity');
    assert.match(crlfBody, /body/);
    assert.match(crlfBody, /sub body/);
    assert.doesNotMatch(crlfBody, /Other harnesses/);
  });

  it('antigravity model section names both models by id', () => {
    const s = modelChoiceSection();
    assert.match(s, /Gemini Flash/);
    assert.match(s, /gemini-3\.8-flash/);
    assert.match(s, /Gemini 4 Argon/);
    assert.match(s, /gemini-4-argon/);
  });

  it('escalation targets Gemini 4 Argon, not an alias', () => {
    const s = modelChoiceSection();
    assert.match(s, /[Ee]scalate[^.\n]*Gemini 4 Argon/);
    assert.doesNotMatch(s, /[Ee]scalate[^.\n]*`'pro'`/);
  });

  it('model values are documented as tier aliases', () => {
    const s = modelChoiceSection();
    assert.match(s, /alias/i);
    const lines = s.split('\n');
    const mapLine = lines.find((l) => l.includes("'pro'") && l.includes('Gemini 4 Argon'));
    assert.ok(mapLine, "must map 'pro' to Gemini 4 Argon on one line");
    assert.match(s, /no Gemini Pro model/i);
  });

  it('no Gemini Pro model is presented', () => {
    const sec = antigravitySection();
    const lines = sec.split('\n');
    const disclaimerLines = lines.filter((l) => /no gemini pro model/i.test(l));
    assert.equal(disclaimerLines.length, 1, 'expected exactly one disclaimer line');
    const otherLines = lines.filter((l) => !/no gemini pro model/i.test(l));
    const filteredText = otherLines.join('\n');
    assert.doesNotMatch(filteredText, /Gemini[ -]?[\d.]*\s?Pro\b/i);
    assert.doesNotMatch(filteredText, /\bpro model\b/i);
  });

  it("every 'pro' mention is explained", () => {
    const sec = antigravitySection();
    const proLines = sec.split('\n').filter((l) => l.includes("'pro'"));
    assert.ok(proLines.length >= 1, "expected at least one line containing 'pro'");
    for (const line of proLines) {
      assert.ok(
        line.includes('Gemini 4 Argon') || line.includes('alias'),
        `Line containing 'pro' must mention Gemini 4 Argon or alias: ${line}`
      );
    }
  });

  it('explicit Model, never inherit', () => {
    const s = modelChoiceSection();
    assert.match(s, /explicit/i);
    assert.match(s, /`Model`/);
    assert.match(s, /[Nn]ever[^.\n]*'inherit'/);
  });

  it('handoff names the model, not just the alias', () => {
    const s = modelChoiceSection();
    assert.match(s, /handoff packet/i);
    assert.match(s, /controller report/i);
  });

  it('controller recommendation names Gemini 4 Argon', () => {
    const sec = antigravitySection();
    assert.ok(sec.includes('Gemini 4 Argon (`gemini-4-argon-high`)'));
    assert.doesNotMatch(sec, /Gemini 4 \(/);
  });

  it("antigravity section names no other vendor's model", () => {
    const sec = antigravitySection();
    for (const name of ['gpt-', 'astra', 'sol', 'terra', 'qwen', 'claude', 'sonnet', 'opus']) {
      const re = name === 'claude'
        ? /(?<![./])\bclaude\b/i
        : name.endsWith('-')
        ? new RegExp(`\\b${name}`, 'i')
        : new RegExp(`\\b${name}\\b`, 'i');
      assert.doesNotMatch(sec, re, `foreign model name present: ${name}`);
    }
  });

  it('read-only discipline paragraph preserved', () => {
    const s = modelChoiceSection();
    assert.ok(s.includes('Source read-only discipline during verification'));
  });
});
