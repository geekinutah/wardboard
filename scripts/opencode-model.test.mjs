import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const adapterDir = join(root, '.opencode', 'agents');
const controllerPath = join(adapterDir, 'controller.md');
const readmePath = join(root, 'docs', 'agents', 'README.md');

/**
 * Return the body of the section whose heading line is exactly `heading`,
 * bounded by the next heading of the same or higher level. Throws a clear
 * error if the section is missing.
 */
export function extractSection(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === heading);
  assert.notEqual(start, -1, `section not found: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
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

const controllerSection = () =>
  extractSection(readFileSync(controllerPath, 'utf8'), '## Model choice (OpenCode)');
const readmeSection = (heading) => extractSection(readFileSync(readmePath, 'utf8'), heading);

// Stable key phrases (case-insensitive) that the OpenCode wording must contain.
const SESSION_MODEL = /runs? on (this|the) session's model/i;
const NO_OVERRIDE = /do not pass a `model` override/i;
const NO_SWITCH = /do not switch providers/i;
const NO_BORROWED = /do not apply (another|other) harness's model guidance/i;
const NO_METADATA = /do not infer a model's capability from its name, release date/i;

describe('opencode model choice', () => {
  it('extractor is bounded by the next same-or-higher heading', () => {
    const doc = '# A\n\n## S\nbody\n### Sub\nsub body\n## Next\nother\n';
    const body = extractSection(doc, '## S');
    assert.match(body, /body/);
    assert.match(body, /sub body/);
    assert.doesNotMatch(body, /other/);
    assert.throws(() => extractSection(doc, '## Missing'), /section not found/);
  });

  it('opencode controller adapter uses the session model', () => {
    const s = controllerSection();
    assert.match(s, SESSION_MODEL, 'must say subagents run on the session model');
    assert.match(s, NO_OVERRIDE, 'must forbid a model override');
    assert.match(s, NO_SWITCH, 'must forbid switching providers');
    assert.match(s, /BLOCKED/, 'must report BLOCKED instead of switching models');
    assert.match(s, /fresh verifier/i, 'independence comes from a fresh verifier');
    assert.match(s, /handoff packet/i, 'must name the session model in the handoff packet');
  });

  it('opencode controller adapter does not invite model selection', () => {
    const s = controllerSection();
    for (const phrase of ['pass it explicitly', 'rather than inheriting', 'based on the task']) {
      assert.ok(!s.toLowerCase().includes(phrase), `forbidden phrase present: ${phrase}`);
    }
    for (const name of ['gpt-', 'astra', 'sol', 'terra']) {
      const re = name.endsWith('-') ? new RegExp(`\\b${name}`, 'i') : new RegExp(`\\b${name}\\b`, 'i');
      assert.doesNotMatch(s, re, `foreign model name present: ${name}`);
    }
  });

  it('opencode controller adapter forbids borrowed guidance and metadata guessing', () => {
    const s = controllerSection();
    assert.match(s, NO_BORROWED);
    assert.match(s, NO_METADATA);
  });

  it('opencode adapters pin no model', () => {
    const files = readdirSync(adapterDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length > 0, 'no opencode adapters found');
    for (const f of files) {
      const text = readFileSync(join(adapterDir, f), 'utf8');
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fm, `${f} has no frontmatter`);
      assert.doesNotMatch(fm[1], /^\s*model\s*:/m, `${f} pins a model`);
    }
    assert.equal(existsSync(join(root, 'opencode.json')), false, 'opencode.json must not be committed');
  });

  it('readme opencode model section matches the adapter', () => {
    const s = readmeSection('### Model choice (OpenCode)');
    assert.match(s, SESSION_MODEL);
    assert.match(s, NO_OVERRIDE);
    assert.match(s, NO_SWITCH);
    assert.doesNotMatch(s, /rather than silently inheriting/);
    assert.doesNotMatch(s, /explicit per-invocation override/);
  });

  it('other harness model sections are untouched', () => {
    assert.match(readmeSection('### Model choice (Codex)'), /gpt-6\.1-sol/);
    assert.ok(readmeSection('### Model choice (Google Antigravity)').length > 0);
  });
});
