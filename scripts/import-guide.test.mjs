import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const CREDENTIALS = 'Do not paste credentials into WardBoard, a collector, or a chat.';

const VERSION = 'Version: four-PDF replace and Settings directory photo collection.';

const COLLECT =
  'pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging';

const COLLECT_COMMANDS = [COLLECT, `${COLLECT} --resume`, `${COLLECT} --cleanup`];

const DOWNLOADS = [
  'Callings → Callings by Organization → Print → Download PDF',
  'Reports → Members without Callings → Print → Download PDF',
  'Reports → Out-of-Unit Callings → Print → Download PDF',
  'Reports → Member Directory → Print → Download PDF',
];

const DISCARDED = [
  'phone',
  'email',
  'address',
  'birth date',
  'age',
  'record number',
  'class rosters',
  'ministering',
];

const OPERATOR_SENTENCES = [
  'Use the installed, documented deterministic collector and parsers; do not build an ad hoc scraper, use a model to interpret records, or send source data to an AI/API service.',
  'If the collector is missing, stop and explain what must be installed instead of improvising a data collection method.',
  'Never ask me to send credentials in chat.',
  'Do not read, copy, store, export or log passwords, cookies, tokens, browser profiles or session state.',
  'Limit acquisition to the selected ward\'s Callings by Organization, Members without Callings and Out-of-Unit Callings PDFs, plus individual directory portraits if I request photos.',
  'Do not paste member lists, photos, raw PDF text, full-page captures or personal values into chat, agent memory, logs, repositories or external services.',
  'Present the import preview and let me resolve identity ambiguities and confirm replacement of current.',
  'Never claim a completed import, photo collection, or cleanup without checking the tool\'s reported result.',
];

/**
 * Body of the `## title` section, up to the next heading.
 */
function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `## ${title}`);
  assert.notEqual(start, -1, `missing section ${title}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,6} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function fencedBlocks(text) {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

/** Trimmed lines, so a command is accepted only as its own line. */
function wholeLines(text) {
  return text.split('\n').map((line) => line.trim());
}

describe('import guide', () => {
  it('the guide names this version and the shipped collector', () => {
    const lines = read('docs/import/guide.md').split('\n');
    const heading = lines.findIndex((line) => /^#{1,6} /.test(line));
    assert.notEqual(heading, -1, 'missing heading');
    assert.equal(lines[heading], '# WardBoard import guide');
    assert.equal(lines[heading + 1], VERSION);
  });

  it('the guide names the collector commands', () => {
    const guide = read('docs/import/guide.md');
    const lines = wholeLines(guide);
    for (const command of COLLECT_COMMANDS) {
      assert.ok(lines.includes(command), `missing command line: ${command}`);
    }
    assert.ok(guide.includes('manifest.json'), 'missing manifest.json');
    assert.ok(guide.includes('Directory photos'), 'missing Directory photos');
    assert.ok(guide.includes('Names never appear'), 'missing Names never appear');
    for (const code of ['0', '1', '2']) {
      assert.ok(guide.includes(code), `missing exit code ${code}`);
    }
  });

  it("the guide's primary photo steps are Settings", () => {
    const photos = section(read('docs/import/guide.md'), 'Directory photos');
    for (const phrase of [
      'Collect from the directory',
      'Continue',
      'A phone does not show that window',
      'Import an existing bundle',
    ]) {
      assert.ok(photos.includes(phrase), `Directory photos omits ${phrase}`);
    }

    const settingsSteps = [
      'An Admin opens Settings and uses **Collect from the directory**.',
      'The sign-in window opens on the computer running WardBoard.',
      'A phone does not show that window.',
      'The Admin signs in there, then presses **Continue** in Settings.',
      'Review opens without choosing files.',
      'First photos apply immediately.',
      'An existing portrait is replaced one photo at a time.',
      'Cancel, a failed run, and a finished import remove the temporary collection files.',
      'An Editor does not see **Collect from the directory**.',
      'Both roles can still open **Import an existing bundle**, select `manifest.json` and the portrait files, and review.',
    ];
    let from = 0;
    for (const sentence of settingsSteps) {
      const at = photos.indexOf(sentence, from);
      assert.notEqual(at, -1, `missing or reordered Settings step: ${sentence}`);
      from = at + sentence.length;
    }

    const commandAt = photos.indexOf(COLLECT);
    assert.notEqual(commandAt, -1, 'missing fallback command');
    assert.ok(
      photos.indexOf('Collect from the directory') < commandAt,
      'Collect from the directory is not before the fallback command',
    );
    assert.ok(
      photos.indexOf(settingsSteps[settingsSteps.length - 1]) < commandAt,
      'Settings steps are not before the fallback command',
    );

    const lines = wholeLines(photos);
    for (const command of COLLECT_COMMANDS) {
      assert.ok(lines.includes(command), `missing command line: ${command}`);
    }

    const split = lines.findIndex((line) => line === 'Command-line fallback');
    assert.notEqual(split, -1, 'missing Command-line fallback line');
    const before = lines.slice(0, split).join('\n');
    const after = lines.slice(split + 1).join('\n');
    assert.equal(before.includes('--cleanup'), false, 'Settings steps mention --cleanup');
    assert.ok(after.includes('--cleanup'), 'fallback omits --cleanup');
    for (const command of COLLECT_COMMANDS) {
      assert.ok(after.includes(command), `fallback command is not after Command-line fallback: ${command}`);
    }
  });

  it('the guide forbids pasting credentials', () => {
    const signIn = section(read('docs/import/guide.md'), 'Sign in');
    assert.ok(signIn.includes(CREDENTIALS), 'sign-in section omits the credentials sentence');
  });

  it('the guide names the four official downloads', () => {
    const guide = read('docs/import/guide.md');
    for (const path of DOWNLOADS) {
      assert.ok(guide.includes(path), `missing download path: ${path}`);
    }
  });

  it('the guide previews with the four json fields', () => {
    const preview = fencedBlocks(read('docs/import/guide.md')).find(
      (block) =>
        (block.includes('POST') || block.includes('-X POST')) &&
        block.includes('/api/import/preview') &&
        block.includes('organizations') &&
        block.includes('withoutCallings') &&
        block.includes('outOfUnit') &&
        block.includes('memberList'),
    );
    assert.ok(preview, 'missing preview command');
    assert.equal(preview.includes('data:'), false, 'preview command uses a data URL');
  });

  it('the guide replaces with a version and resolutions', () => {
    const replace = fencedBlocks(read('docs/import/guide.md')).find(
      (block) =>
        block.includes('/api/import/replace') &&
        block.includes('expectedVersion') &&
        block.includes('confirmReturn'),
    );
    assert.ok(replace, 'missing replace command');
  });

  it('the guide refuses a duplicate and a disagreement', () => {
    const guide = read('docs/import/guide.md');
    assert.ok(guide.includes('duplicate_report'), 'missing duplicate_report');
    assert.ok(guide.includes('inconsistentReports'), 'missing inconsistentReports');
  });

  it('the guide lists the discarded fields', () => {
    const guide = read('docs/import/guide.md');
    const start = guide.indexOf('Discarded');
    assert.notEqual(start, -1, 'missing discarded list');
    const line = guide.slice(start, guide.indexOf('\n', start));
    for (const field of DISCARDED) {
      assert.ok(line.includes(field), `discarded list omits ${field}`);
    }
  });

  it('the guide keeps member gender', () => {
    const guide = read('docs/import/guide.md');
    assert.ok(guide.includes('gender (M or F)'), 'missing gender (M or F)');
    assert.ok(guide.includes('needsGender'), 'missing needsGender');
    assert.ok(guide.includes('"gender": "M"'), 'missing "gender": "M"');
    assert.ok(guide.includes('"gender": "F"'), 'missing "gender": "F"');
    const start = guide.indexOf('Discarded');
    assert.notEqual(start, -1, 'missing discarded list');
    const line = guide.slice(start, guide.indexOf('\n', start));
    assert.equal(line.includes('gender'), false, 'discarded line includes gender');
  });

  it('the guide does not invent a collector command', () => {
    const guide = read('docs/import/guide.md');
    for (const forbidden of ['TODO', 'TBD', '<command>', 'npx wardboard-collector']) {
      assert.equal(guide.includes(forbidden), false, `guide contains ${forbidden}`);
    }
    for (const block of fencedBlocks(guide)) {
      assert.equal(
        block.includes('churchofjesuschrist.org'),
        false,
        'fenced block contains churchofjesuschrist.org',
      );
    }
  });

  it('the operator prompt keeps the required sentences', () => {
    const text = read('docs/import/operator-prompt.md');
    const fence = text.indexOf('```');
    assert.ok(fence > 0, 'missing fenced prompt');
    let from = fence;
    for (const sentence of OPERATOR_SENTENCES) {
      const at = text.indexOf(sentence, from);
      assert.notEqual(at, -1, `missing or reordered sentence: ${sentence}`);
      from = at + sentence.length;
    }
  });

  it('the operator prompt points at the shipped guide', () => {
    const text = read('docs/import/operator-prompt.md');
    const fence = text.indexOf('```');
    assert.ok(fence > 0, 'missing fenced prompt');
    const above = text.slice(0, fence);
    assert.ok(above.includes('docs/import/guide.md'), 'prompt does not point at the guide');
    assert.ok(above.includes(COLLECT), 'prompt omits the collect command');
    assert.equal(above.includes('not shipped'), false, 'prompt still says not shipped');
  });
});
