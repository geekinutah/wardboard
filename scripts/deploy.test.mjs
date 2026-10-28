import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');

function read(rel) {
  const full = join(root, rel);
  assert.ok(existsSync(full), `${rel} is missing`);
  return readFileSync(full, 'utf8');
}

/** Items of every `ports:` list, comments skipped, surrounding quotes removed. */
function portsEntries(text) {
  const lines = text.split('\n');
  const entries = [];
  let collecting = false;
  let keyIndent = -1;
  for (const line of lines) {
    if (!collecting) {
      const key = /^(\s*)ports:\s*$/.exec(line);
      if (key !== null) {
        collecting = true;
        keyIndent = key[1].length;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.search(/\S/);
    if (indent <= keyIndent || !trimmed.startsWith('-')) {
      collecting = false;
      continue;
    }
    entries.push(trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
  }
  return entries;
}

/** Non-comment lines of the first `environment:` block. */
function environmentLines(text) {
  const lines = text.split('\n');
  const entries = [];
  let collecting = false;
  let keyIndent = -1;
  for (const line of lines) {
    if (!collecting) {
      const key = /^(\s*)environment:\s*$/.exec(line);
      if (key !== null) {
        collecting = true;
        keyIndent = key[1].length;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.search(/\S/);
    if (indent <= keyIndent) break;
    entries.push(trimmed);
  }
  return entries;
}

function section(text, title) {
  const match = new RegExp(`^## ${title}\\s*$`, 'm').exec(text);
  assert.ok(match, `missing section "## ${title}"`);
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function fenced(text) {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]).join('\n');
}

/** Project name plus the volume mounted at /data, as Docker Compose names it. */
function composeDataVolume(text) {
  const name = /^name:\s*(\S+)\s*$/m.exec(text);
  assert.ok(name, 'compose file has no top-level project name');
  const mount = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9_.-]*):\/data\b/.exec(text);
  assert.ok(mount, 'compose file has no volume mounted at /data');
  return `${name[1]}_${mount[1]}`;
}

/** Shell command containing `index`, including backslash continuations. */
function commandAt(text, index) {
  const lines = text.split('\n');
  let offset = 0;
  let lineIdx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const end = offset + lines[i].length;
    if (index <= end) {
      lineIdx = i;
      break;
    }
    offset = end + 1;
  }
  let start = lineIdx;
  while (start > 0 && /\\\s*$/.test(lines[start - 1])) start -= 1;
  let end = lineIdx;
  while (end < lines.length - 1 && /\\\s*$/.test(lines[end])) end += 1;
  return lines.slice(start, end + 1).join('\n');
}

describe('docker/compose.yaml', () => {
  it('compose publishes the app port on loopback only', () => {
    const entries = portsEntries(read('docker/compose.yaml'));

    assert.ok(entries.length >= 1, 'compose service declares no ports');
    for (const entry of entries) {
      assert.ok(entry.startsWith('127.0.0.1:'), `port entry "${entry}" is not loopback-only`);
    }
  });

  it('compose passes through the initial-admin login with no default', () => {
    const lines = environmentLines(read('docker/compose.yaml'));
    const line = lines.find((entry) => entry.startsWith('WARDBOARD_INITIAL_ADMIN_LOGIN:'));

    assert.ok(line, 'environment block is missing WARDBOARD_INITIAL_ADMIN_LOGIN');
    assert.match(
      line,
      /^WARDBOARD_INITIAL_ADMIN_LOGIN:\s*\$\{WARDBOARD_INITIAL_ADMIN_LOGIN\}\s*$/,
      'initial-admin login must be ${WARDBOARD_INITIAL_ADMIN_LOGIN} with no fallback',
    );
    const braces = /\$\{([^}]*)\}/.exec(line);
    assert.ok(braces !== null, 'missing ${...} substitution');
    assert.ok(!braces[1].includes(':-') && !braces[1].includes('-'), 'fallback inside the braces');
  });

  it('compose requires the base URL with no default', () => {
    const lines = environmentLines(read('docker/compose.yaml'));
    const line = lines.find((entry) => entry.startsWith('WARDBOARD_BASE_URL:'));

    assert.ok(line, 'environment block is missing WARDBOARD_BASE_URL');
    assert.match(
      line,
      /^WARDBOARD_BASE_URL:\s*\$\{WARDBOARD_BASE_URL\}\s*$/,
      'WARDBOARD_BASE_URL must be required, with no :- fallback',
    );
  });

  it('compose keeps the fixed project name and data volume', () => {
    const text = read('docker/compose.yaml');

    assert.match(text, /^name:\s*wardboard\s*$/m, 'compose project name must be wardboard');
    assert.match(text, /(?:^|\s)wardboard-data:\/data\b/, 'wardboard-data must be mounted at /data');
  });
});

describe('docker/.env.example', () => {
  it('.env.example defines both required variables with placeholders only', () => {
    const sets = read('docker/.env.example')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && line.includes('='));

    const valueOf = (line) => line.slice(line.indexOf('=') + 1);
    const keyOf = (line) => line.slice(0, line.indexOf('=')).trim();

    assert.ok(
      sets.some((line) => keyOf(line) === 'WARDBOARD_BASE_URL'),
      'missing uncommented WARDBOARD_BASE_URL=',
    );
    assert.ok(
      sets.some((line) => keyOf(line) === 'WARDBOARD_INITIAL_ADMIN_LOGIN'),
      'missing uncommented WARDBOARD_INITIAL_ADMIN_LOGIN=',
    );
    for (const line of sets) {
      assert.match(valueOf(line), /<[^>\s]+>/, `set value must contain a <…> placeholder: ${line}`);
    }
  });
});

describe('docs/deploy.md', () => {
  it("the runbook's serve command is persistent", () => {
    const text = read('docs/deploy.md');
    const persistent = text.split('\n').find(
      (line) => /\btailscale serve\b/.test(line) && /(?:^|\s)--bg(?:\s|$)/.test(line) && /\blocalhost:8080\b/.test(line),
    );

    assert.ok(
      persistent,
      'deploy.md must contain a tailscale serve command with --bg and target localhost:8080',
    );
    assert.match(
      text,
      /serve target must match `WARDBOARD_PORT` if that is changed/,
      'the runbook must note the serve target matches WARDBOARD_PORT when that port changes',
    );
  });

  it('the runbook backs up a quiesced volume', () => {
    const backup = section(read('docs/deploy.md'), 'Backup');
    const stop = backup.indexOf('docker compose stop');
    const tar = backup.indexOf('tar -czf');
    const up = backup.indexOf('docker compose up -d');

    assert.ok(stop !== -1, 'Backup section is missing docker compose stop');
    assert.ok(tar !== -1, 'Backup section is missing tar -czf');
    assert.ok(up !== -1, 'Backup section is missing docker compose up -d');
    assert.ok(stop < tar, 'docker compose stop must appear before tar -czf');
    assert.ok(tar < up, 'docker compose up -d must appear after tar -czf');
  });

  it('the runbook validates the archive before swapping the live volume', () => {
    const restore = section(read('docs/deploy.md'), 'Restore');
    const swap = restore.indexOf('mindepth 1 -delete');
    const integrity = restore.indexOf('PRAGMA integrity_check');
    const snapshot = restore.indexOf('tar -czf /backup/wardboard-pre-restore');

    assert.ok(swap !== -1, 'Restore section is missing the volume-content swap');
    assert.ok(integrity !== -1, 'Restore section is missing the integrity_check step');
    assert.ok(integrity < swap, 'integrity_check must appear before the volume swap');
    assert.ok(snapshot !== -1 && snapshot < swap, 'pre-restore snapshot must appear before the volume swap');

    const after = restore.slice(swap);
    const up = after.indexOf('docker compose up -d');
    assert.ok(up !== -1, 'docker compose up -d must appear after the volume swap');
    assert.match(after.slice(up), /verif/i, 'a verification sentence must appear after docker compose up -d');
  });

  it('the pre-restore snapshot is outside the temp dir and the swap source', () => {
    const restore = fenced(section(read('docs/deploy.md'), 'Restore'));
    const snapshotAt = restore.indexOf('tar -czf /backup/wardboard-pre-restore');
    assert.ok(snapshotAt !== -1, 'Restore commands are missing the pre-restore snapshot tar');
    const snapshotCmd = commandAt(restore, snapshotAt);
    const snapMount = /-v\s+"?([^":\s]+):\/backup"?/.exec(snapshotCmd);
    assert.ok(snapMount, `pre-restore docker run does not mount a host path at /backup:\n${snapshotCmd}`);
    const snapHost = snapMount[1];
    assert.ok(
      snapHost === '~/wardboard-backups' || snapHost === '$HOME/wardboard-backups',
      `pre-restore snapshot path is ${snapHost}; it must be ~/wardboard-backups (not under $TMP)`,
    );

    const swapAt = restore.indexOf('mindepth 1 -delete');
    assert.ok(swapAt !== -1, 'Restore commands are missing the volume swap');
    const swapCmd = commandAt(restore, swapAt);
    const swapMount = /-v\s+"?([^":\s]+):\/new"?/.exec(swapCmd);
    assert.ok(swapMount, `swap does not mount the unpack directory at /new:\n${swapCmd}`);
    const swapHost = swapMount[1];
    assert.equal(swapHost, '$TMP', 'swap source must be the unpack directory $TMP only');
    assert.ok(
      snapHost !== swapHost && !snapHost.startsWith(`${swapHost}/`) && !snapHost.includes('$TMP'),
      `pre-restore snapshot ${snapHost} is inside the swap source ${swapHost}`,
    );

    const setE = restore.search(/(^|\n)set -e(?:\s|$)/);
    const up = restore.indexOf('docker compose up -d');
    const rm = restore.indexOf('rm -rf "$TMP"');
    assert.ok(setE !== -1, 'restore script is missing set -e');
    assert.ok(up !== -1 && rm !== -1, 'restore script must still start the app and remove only the temp dir');
    assert.ok(setE < up && setE < rm, 'set -e must precede docker compose up -d and rm -rf "$TMP"');
  });

  it('the runbook re-owns volume contents for the app user', () => {
    const restore = section(read('docs/deploy.md'), 'Restore');
    const swap = restore.indexOf('mindepth 1 -delete');

    assert.ok(swap !== -1, 'Restore section is missing the volume-content swap');
    const step = commandAt(restore, swap);
    assert.match(
      step,
      /chown\b[\s\S]{0,40}\bwardboard\b/,
      'volume-swap step must chown the contents to the wardboard user',
    );
  });

  it("the runbook's volume name matches compose", () => {
    const volume = composeDataVolume(read('docker/compose.yaml'));
    const deploy = read('docs/deploy.md');
    const backup = fenced(section(deploy, 'Backup'));
    const restore = fenced(section(deploy, 'Restore'));

    assert.ok(backup.includes(volume), `Backup commands are missing volume ${volume}`);
    assert.ok(restore.includes(volume), `Restore commands are missing volume ${volume}`);
  });

  it('the runbook keeps backups in the home directory, outside the checkout', () => {
    const text = read('docs/deploy.md');
    const destinations = [...text.matchAll(/wardboard-backups/g)];

    assert.ok(destinations.length > 0, 'deploy.md never names the backup directory');
    for (const match of destinations) {
      const prefix = text.slice(Math.max(0, match.index - 6), match.index);
      assert.ok(
        prefix.endsWith('~/') || prefix.endsWith('$HOME/'),
        `backup path must be ~/wardboard-backups or $HOME/wardboard-backups, saw "${prefix}${match[0]}"`,
      );
    }
    assert.doesNotMatch(text, /(?:^|[\s"'`(])(?:\.\/|\.\.\/)[^\s"'`)]*backup/);
  });

  it('the runbook sections are in the contract order', () => {
    const headings = [...read('docs/deploy.md').matchAll(/^## (.+)\s*$/gm)].map((match) => match[1].trim());

    assert.deepEqual(headings, [
      'What this is',
      'Prerequisites',
      'First install',
      'Verify install',
      'Counselor access',
      'Upgrade',
      'Backup',
      'Restore',
      'Teardown',
      'Troubleshooting',
    ]);
  });

  it('the runbook notes a pre-T-022 image leaves the admin variable inert', () => {
    const verify = section(read('docs/deploy.md'), 'Verify install');

    assert.match(
      verify,
      /until the app ships people & access \(T-022\), every signed-in tailnet user passes the identity gate and the admin variable is inert/,
    );
  });

  it('the runbook archive is the whole data tree', () => {
    const backup = section(read('docs/deploy.md'), 'Backup');

    assert.match(backup, /whole `\/data` tree/);
    assert.match(backup, /wardboard\.sqlite/);
    assert.match(backup, /WAL sidecars/);
  });

  it('the runbook troubleshooting covers tagged devices, missing roles, the base URL, and OrbStack', () => {
    const trouble = section(read('docs/deploy.md'), 'Troubleshooting');

    assert.match(trouble, /\{"error":"unauthenticated"\}/);
    assert.match(trouble, /tagged device/i);
    assert.match(trouble, /403/);
    assert.match(trouble, /invite in the app as admin/i);
    assert.match(trouble, /WARDBOARD_INITIAL_ADMIN_LOGIN/);
    assert.match(trouble, /WARDBOARD_BASE_URL/);
    assert.match(trouble, /WebSocket/);
    assert.match(trouble, /OrbStack not running/);
    assert.match(trouble, /socket/i);
    assert.match(trouble, /docker compose logs --tail 100 wardboard/);
  });
});
