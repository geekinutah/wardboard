import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflowPath = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');

// Top-level `on:` triggers, accepting the block-mapping, list, and inline-list forms.
function triggers(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start === -1) return [];
  const inline = lines[start].replace(/^["']?on["']?\s*:/, '').trim();
  if (inline) return inline.replace(/[[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^\s{2}(?:-\s*)?([A-Za-z_]+)\s*:?\s*$/.exec(line) ?? /^\s{2}([A-Za-z_]+)\s*:/.exec(line);
    if (match) found.push(match[1]);
  }
  return found;
}

describe('ci workflow', () => {
  const text = readFileSync(workflowPath, 'utf8');

  it('ci workflow runs setup and verify', () => {
    assert.match(text, /^\s+run:\s*\.\/scripts\/setup\.sh\s*$/m);
    assert.match(text, /^\s+run:\s*\.\/scripts\/verify\.sh\s*$/m);
    assert.ok(text.indexOf('scripts/setup.sh') < text.indexOf('scripts/verify.sh'), 'setup runs before verify');
  });

  it('ci workflow reads the Node version from .node-version', () => {
    assert.match(text, /node-version-file:\s*['"]?\.node-version['"]?/);
    assert.match(text, /uses:\s*actions\/setup-node@/);
    assert.match(text, /uses:\s*pnpm\/action-setup@/);
  });

  it('ci workflow triggers on push and pull_request', () => {
    const on = triggers(text);
    assert.ok(on.includes('push'), `triggers: ${on.join(', ')}`);
    assert.ok(on.includes('pull_request'), `triggers: ${on.join(', ')}`);
  });

  it('ci workflow uses no secrets', () => {
    assert.doesNotMatch(text, /secrets\./);
  });

  it('ci workflow runs the docker smoke only through verify.sh', () => {
    assert.doesNotMatch(text, /^\s{2}docker-smoke\s*:/m, 'no docker-smoke job');
    assert.doesNotMatch(text, /docker-smoke\.sh/, 'the workflow must not call docker-smoke.sh directly');
    assert.match(text, /^\s+run:\s*\.\/scripts\/verify\.sh\s*$/m);
  });
});
