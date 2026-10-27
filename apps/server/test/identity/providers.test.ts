import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  fixtureIdentityProvider,
  tailscaleIdentityProvider,
  type Identity,
} from '../../src/index.ts';

function makeRequest(rawHeaders: string[]): IncomingMessage {
  const headers: Record<string, string> = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = (rawHeaders[i] ?? '').toLowerCase();
    const val = rawHeaders[i + 1] ?? '';
    const existing = headers[key];
    headers[key] = existing !== undefined ? `${existing}, ${val}` : val;
  }
  return {
    rawHeaders,
    headers,
  } as unknown as IncomingMessage;
}

describe('tailscaleIdentityProvider', () => {
  const provider = tailscaleIdentityProvider();

  it('tailscale: valid login and name yield identity', () => {
    const req = makeRequest([
      'Tailscale-User-Login',
      'alice@example.test',
      'Tailscale-User-Name',
      'Alice Example',
    ]);
    const result = provider.identify(req);
    expect(result).toEqual({
      ok: true,
      identity: {
        login: 'alice@example.test',
        displayName: 'Alice Example',
      },
    });
  });

  it('tailscale: login is trimmed and lowercased', () => {
    const req = makeRequest(['Tailscale-User-Login', ' Alice@Example.TEST ']);
    const result = provider.identify(req);
    expect(result).toEqual({
      ok: true,
      identity: {
        login: 'alice@example.test',
        displayName: 'alice@example.test',
      },
    });
  });

  it('tailscale: header name is case-insensitive', () => {
    const req = makeRequest([
      'TAILSCALE-USER-LOGIN',
      'alice@example.test',
      'tailscale-user-name',
      'Alice Example',
    ]);
    const result = provider.identify(req);
    expect(result).toEqual({
      ok: true,
      identity: {
        login: 'alice@example.test',
        displayName: 'Alice Example',
      },
    });
  });

  it('tailscale: missing login is refused as missing', () => {
    const reqWithNameOnly = makeRequest(['Tailscale-User-Name', 'Alice Example']);
    expect(provider.identify(reqWithNameOnly)).toEqual({
      ok: false,
      reason: 'missing',
    });

    const reqEmpty = makeRequest([]);
    expect(provider.identify(reqEmpty)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('tailscale: empty or whitespace login is malformed', () => {
    expect(provider.identify(makeRequest(['Tailscale-User-Login', '']))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(provider.identify(makeRequest(['Tailscale-User-Login', '   ']))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('tailscale: duplicate login headers are malformed', () => {
    const req = makeRequest([
      'Tailscale-User-Login',
      'alice@example.test',
      'Tailscale-User-Login',
      'bob@example.test',
    ]);
    expect(provider.identify(req)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('tailscale: login with comma, inner space or control char is malformed', () => {
    const invalidLogins = [
      'a@x.test, b@x.test',
      'a b@x.test',
      'a\u0007@x.test',
      'a\u0000@x.test',
      'a\u001f@x.test',
      'a\u007f@x.test',
    ];
    for (const login of invalidLogins) {
      const result = provider.identify(makeRequest(['Tailscale-User-Login', login]));
      expect(result, `login: ${JSON.stringify(login)}`).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('tailscale: login length boundary', () => {
    const login254 = 'a'.repeat(241) + '@example.test';
    expect(login254.length).toBe(254);
    const result254 = provider.identify(makeRequest(['Tailscale-User-Login', login254]));
    expect(result254).toEqual({
      ok: true,
      identity: {
        login: login254,
        displayName: login254,
      },
    });

    const login255 = 'a'.repeat(242) + '@example.test';
    expect(login255.length).toBe(255);
    const result255 = provider.identify(makeRequest(['Tailscale-User-Login', login255]));
    expect(result255).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('tailscale: RFC 2047 Q and B display names are decoded', () => {
    const reqQ = makeRequest([
      'Tailscale-User-Login',
      'ferris@example.test',
      'Tailscale-User-Name',
      '=?utf-8?q?Ferris_B=C3=BCller?=',
    ]);
    expect(provider.identify(reqQ)).toEqual({
      ok: true,
      identity: {
        login: 'ferris@example.test',
        displayName: 'Ferris Büller',
      },
    });

    // B-encoded equivalent: Buffer.from('Ferris Büller', 'utf8').toString('base64') -> 'RmVycmlzIELDvGxsZXI='
    const reqB = makeRequest([
      'Tailscale-User-Login',
      'ferris@example.test',
      'Tailscale-User-Name',
      '=?UTF-8?B?RmVycmlzIELDvGxsZXI=?=',
    ]);
    expect(provider.identify(reqB)).toEqual({
      ok: true,
      identity: {
        login: 'ferris@example.test',
        displayName: 'Ferris Büller',
      },
    });
  });

  it('tailscale: missing, duplicate, empty or malformed name falls back to login', () => {
    const cases: Array<[label: string, headers: string[]]> = [
      ['missing', ['Tailscale-User-Login', 'alice@example.test']],
      [
        'duplicate',
        [
          'Tailscale-User-Login',
          'alice@example.test',
          'Tailscale-User-Name',
          'Alice One',
          'Tailscale-User-Name',
          'Alice Two',
        ],
      ],
      ['empty', ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '']],
      ['whitespace', ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '   ']],
      [
        'malformed Q encoded',
        ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '=?utf-8?q?bad=XX?='],
      ],
      [
        'non-utf8 charset',
        ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '=?iso-8859-1?q?Alice?='],
      ],
      [
        'malformed B encoded',
        ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '=?utf-8?b?invalid*b64?='],
      ],
      [
        'incomplete encoded word',
        ['Tailscale-User-Login', 'alice@example.test', 'Tailscale-User-Name', '=?utf-8?q?incomplete'],
      ],
    ];

    for (const [label, headers] of cases) {
      const result = provider.identify(makeRequest(headers));
      expect(result, label).toEqual({
        ok: true,
        identity: {
          login: 'alice@example.test',
          displayName: 'alice@example.test',
        },
      });
    }
  });

  it('tailscale: display name control chars stripped and truncated to 200', () => {
    const name250WithNull = 'a'.repeat(100) + '\u0000' + 'b'.repeat(150);
    const expected = 'a'.repeat(100) + 'b'.repeat(100);
    expect(expected.length).toBe(200);

    const req = makeRequest([
      'Tailscale-User-Login',
      'alice@example.test',
      'Tailscale-User-Name',
      name250WithNull,
    ]);
    const result = provider.identify(req);
    expect(result).toEqual({
      ok: true,
      identity: {
        login: 'alice@example.test',
        displayName: expected,
      },
    });
  });

  it('tailscale: profile pic and unrelated headers ignored', () => {
    const req = makeRequest([
      'Tailscale-User-Profile-Pic',
      'https://example.test/pic.png',
      'Host',
      'localhost:8080',
      'User-Agent',
      'test-agent',
    ]);
    expect(provider.identify(req)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('fixtureIdentityProvider', () => {
  it('fixture: returns configured identity', () => {
    const identity: Identity = {
      login: 'fixture@example.test',
      displayName: 'Fixture User',
    };
    const provider = fixtureIdentityProvider(identity);
    const req = makeRequest([]);
    expect(provider.identify(req)).toEqual({
      ok: true,
      identity,
    });
  });

  it('fixture: null refuses as missing', () => {
    const provider = fixtureIdentityProvider(null);
    const req = makeRequest(['Tailscale-User-Login', 'alice@example.test']);
    expect(provider.identify(req)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});
