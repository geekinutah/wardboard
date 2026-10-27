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

const PIN = 'lmstudio/qwen3.8-27b-splash';
const ADAPTERS = ['controller', 'implementer', 'verifier'];

/**
 * Return the YAML frontmatter (between the first two `---` lines), or throw a
 * clear error if missing.
 */
export function extractFrontmatter(text, label = 'file') {
  const lines = text.split('\n');
  assert.equal(lines[0], '---', `${label} has no frontmatter`);
  const end = lines.indexOf('---', 1);
  assert.notEqual(end, -1, `${label} frontmatter is not closed`);
  return lines.slice(1, end).join('\n');
}

// Stable key phrases (case-insensitive) that the OpenCode wording must contain.
const NO_OVERRIDE = /do not pass a `model` override on the subagent tool/i;
const NO_SWITCH = /do not switch model or provider/i;
const NO_BORROWED = /do not apply (another|other) harness's model guidance/i;
const NO_METADATA = /do not infer a model's capability from its name, release date/i;
const BLOCKED = /report BLOCKED to Mike rather than switching models/i;

describe('opencode model choice', () => {
  it('extractors are bounded', () => {
    const doc = '# A\n\n## S\nbody\n### Sub\nsub body\n## Next\nother\n';
    const body = extractSection(doc, '## S');
    assert.match(body, /body/);
    assert.match(body, /sub body/);
    assert.doesNotMatch(body, /other/);
    assert.throws(() => extractSection(doc, '## Missing'), /section not found/);
    const fm = extractFrontmatter('---\na: 1\n---\nmodel: x\n');
    assert.match(fm, /a: 1/);
    assert.doesNotMatch(fm, /model/);
    assert.throws(() => extractFrontmatter('no fm'), /no frontmatter/);
    assert.throws(() => extractFrontmatter('---\na: 1\n'), /not closed/);
  });

  it('every opencode adapter pins qwen3.8-27b-splash', () => {
    for (const a of ADAPTERS) {
      const fm = extractFrontmatter(readFileSync(join(adapterDir, `${a}.md`), 'utf8'), a);
      const keys = fm.split('\n').filter((l) => /^model\s*:/.test(l));
      assert.deepEqual(keys, [`model: ${PIN}`], `${a} must have exactly one model: ${PIN}`);
    }
    for (const f of ['opencode.json', 'opencode.jsonc']) {
      assert.equal(existsSync(join(root, f)), false, `${f} must not be committed`);
    }
  });

  it('opencode controller forbids model overrides', () => {
    const s = controllerSection();
    assert.ok(s.includes(`\`${PIN}\``), 'must name the pinned model');
    assert.match(s, /only Mike changes it/i, 'must say only Mike changes the pin');
    assert.match(s, NO_OVERRIDE, 'must forbid a model override');
    assert.match(s, NO_SWITCH, 'must forbid switching model/provider');
    assert.match(s, /correction rounds/i);
    assert.match(s, /security-sensitive/i);
  });

  it('opencode controller does not invite model selection', () => {
    const s = controllerSection();
    for (const phrase of ['pass it explicitly', 'rather than inheriting', 'never pin a model', 'based on the task']) {
      assert.ok(!s.toLowerCase().includes(phrase), `forbidden phrase present: ${phrase}`);
    }
    for (const name of ['gpt-', 'astra', 'sol', 'terra', 'gemma', 'claude', 'sonnet', 'opus']) {
      const re = name.endsWith('-') ? new RegExp(`\\b${name}`, 'i') : new RegExp(`\\b${name}\\b`, 'i');
      assert.doesNotMatch(s, re, `foreign model name present: ${name}`);
    }
  });

  it('opencode controller forbids borrowed guidance and metadata guessing', () => {
    const s = controllerSection();
    assert.match(s, NO_BORROWED);
    assert.match(s, NO_METADATA);
    assert.match(s, BLOCKED);
    assert.match(s, /fresh verifier/i, 'independence comes from a fresh verifier');
    assert.match(s, /handoff packet/i, 'must name the model in the handoff packet');
  });

  it('readme opencode model section matches the pin', () => {
    const s = readmeSection('### Model choice (OpenCode)');
    assert.ok(s.includes(`\`${PIN}\``), 'must name the pinned model');
    assert.match(s, NO_OVERRIDE);
    assert.match(s, NO_SWITCH);
    assert.match(s, NO_BORROWED);
    assert.match(s, NO_METADATA);
    assert.match(s, BLOCKED);
    assert.doesNotMatch(s, /rather than silently inheriting/);
    assert.doesNotMatch(s, /explicit per-invocation override/);
    assert.doesNotMatch(s, /No model is pinned/i);
  });

  it('readme repo-wide model sentence names the opencode exception', () => {
    const text = readFileSync(readmePath, 'utf8');
    const para = text.split(/\n\s*\n/).find((p) => p.includes('Model settings remain unset in committed adapters'));
    assert.ok(para, 'repo-wide model sentence not found');
    assert.match(para, /OpenCode/);
    assert.ok(para.includes(PIN), 'must name the pinned model');
  });

  it('other harness model sections are untouched', () => {
    assert.match(readmeSection('### Model choice (Codex)'), /gpt-6\.1-sol/);
    assert.ok(readmeSection('### Model choice (Google Antigravity)').length > 0);
    for (const dir of ['.claude', '.grok']) {
      const d = join(root, dir, 'agents');
      for (const f of readdirSync(d).filter((x) => x.endsWith('.md'))) {
        const fm = extractFrontmatter(readFileSync(join(d, f), 'utf8'), `${dir}/${f}`);
        assert.doesNotMatch(fm, /^\s*model\s*:/m, `${dir}/${f} gained a model key`);
      }
    }
    const cd = join(root, '.codex', 'agents');
    for (const f of readdirSync(cd).filter((x) => x.endsWith('.toml'))) {
      assert.doesNotMatch(readFileSync(join(cd, f), 'utf8'), /^\s*model\s*=/m, `.codex/${f} gained a model key`);
    }
  });
});
