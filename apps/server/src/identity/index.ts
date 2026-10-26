import type { IncomingMessage } from 'node:http';

export type Identity = {
  readonly login: string;
  readonly displayName: string;
};

export type IdentityResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: 'missing' | 'malformed' };

export interface IdentityProvider {
  identify(req: IncomingMessage): IdentityResult;
}

export const authenticatedIdentities = new WeakMap<IncomingMessage, Identity>();

export function getAuthenticatedIdentity(req: IncomingMessage): Identity | undefined {
  return authenticatedIdentities.get(req);
}

function decodeQ(text: string): string | null {
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === undefined) break;
    if (c === '_') {
      bytes.push(0x20);
      i++;
    } else if (c === '=') {
      if (i + 2 >= text.length) return null;
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 3;
    } else {
      const code = c.charCodeAt(0);
      if (code < 0x20 || code > 0x7e || c === '?' || c === ' ') return null;
      bytes.push(code);
      i++;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

function decodeB(text: string): string | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    return null;
  }
  try {
    const buf = Buffer.from(text, 'base64');
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

function parseEncodedWords(raw: string): string | null {
  const collapsed = raw.replace(
    /(=\?[^?]+\?[^?]+\?[^?]*\?=)\s+(?==\?[^?]+\?[^?]+\?[^?]*\?=)/g,
    '$1',
  );
  const pattern = /=\?([^?\s]+)\?([^?\s]+)\?([^?\s]*)\?=/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(collapsed)) !== null) {
    result += collapsed.slice(lastIndex, match.index);
    lastIndex = pattern.lastIndex;

    const charset = match[1];
    const encoding = match[2];
    const encodedText = match[3];
    if (charset === undefined || encoding === undefined || encodedText === undefined) {
      return null;
    }
    if (charset.toLowerCase() !== 'utf-8') {
      return null;
    }

    const enc = encoding.toLowerCase();
    const decoded =
      enc === 'q' ? decodeQ(encodedText) : enc === 'b' ? decodeB(encodedText) : null;

    if (decoded === null) {
      return null;
    }
    result += decoded;
  }

  result += collapsed.slice(lastIndex);
  if (result.includes('=?')) {
    return null;
  }
  return result;
}

function hasControlCharsOrAngleBrackets(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127 || code === 60 || code === 62) {
      return true;
    }
  }
  return false;
}

function stripControlChars(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      continue;
    }
    result += str.charAt(i);
  }
  return result;
}

function decodeDisplayName(raw: string, fallback: string): string {
  let working = raw;

  if (working.includes('=?')) {
    const parsed = parseEncodedWords(working);
    if (parsed === null) {
      return fallback;
    }
    working = parsed;
  }

  const stripped = stripControlChars(working);
  const trimmed = stripped.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.slice(0, 200);
}

export function tailscaleIdentityProvider(): IdentityProvider {
  return {
    identify(req: IncomingMessage): IdentityResult {
      const rawHeaders = req.rawHeaders;
      const loginHeaders: string[] = [];
      const nameHeaders: string[] = [];

      for (let i = 0; i < rawHeaders.length; i += 2) {
        const headerName = (rawHeaders[i] ?? '').toLowerCase();
        const headerVal = rawHeaders[i + 1] ?? '';
        if (headerName === 'tailscale-user-login') {
          loginHeaders.push(headerVal);
        } else if (headerName === 'tailscale-user-name') {
          nameHeaders.push(headerVal);
        }
      }

      if (loginHeaders.length === 0) {
        return { ok: false, reason: 'missing' };
      }
      if (loginHeaders.length > 1) {
        return { ok: false, reason: 'malformed' };
      }

      const rawLogin = loginHeaders[0];
      if (rawLogin === undefined) {
        return { ok: false, reason: 'missing' };
      }
      const trimmedLogin = rawLogin.trim();
      if (trimmedLogin.length === 0 || trimmedLogin.length > 254) {
        return { ok: false, reason: 'malformed' };
      }
      if (
        /\s/.test(trimmedLogin) ||
        trimmedLogin.includes(',') ||
        hasControlCharsOrAngleBrackets(trimmedLogin)
      ) {
        return { ok: false, reason: 'malformed' };
      }

      const login = trimmedLogin.toLowerCase();
      let displayName = login;

      if (nameHeaders.length === 1 && nameHeaders[0] !== undefined) {
        displayName = decodeDisplayName(nameHeaders[0], login);
      }

      return {
        ok: true,
        identity: {
          login,
          displayName,
        },
      };
    },
  };
}

export function fixtureIdentityProvider(identity: Identity | null): IdentityProvider {
  return {
    identify(): IdentityResult {
      if (identity === null) {
        return { ok: false, reason: 'missing' };
      }
      return { ok: true, identity };
    },
  };
}

export function authenticate(
  provider: IdentityProvider,
  req: IncomingMessage,
): IdentityResult {
  const result = provider.identify(req);
  if (result.ok) {
    authenticatedIdentities.set(req, result.identity);
  }
  return result;
}
