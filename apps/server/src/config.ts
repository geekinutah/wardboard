import path from 'node:path';
import { normalizeLogin } from './access/login.ts';

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
  }
}

export type Config = {
  dataDir: string;
  baseUrl: string;
  port: number;
  host: string;
  webDir?: string;
  trustIdentityHeadersOnNonLoopback?: boolean;
  initialAdminLogin?: string;
};

const PORT_PATTERN = /^(?:0|[1-9][0-9]*)$/;

function normalizeBaseUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname === '') return undefined;
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
}

function parsePort(value: string): number | undefined {
  if (!PORT_PATTERN.test(value)) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port > 65535) return undefined;
  return port;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];

  const dataDir = env['WARDBOARD_DATA_DIR'];
  if (dataDir === undefined) {
    problems.push('WARDBOARD_DATA_DIR is required and must be an absolute path');
  } else if (!path.isAbsolute(dataDir)) {
    problems.push('WARDBOARD_DATA_DIR must be an absolute path');
  }

  const baseRaw = env['WARDBOARD_BASE_URL'];
  const baseUrl = baseRaw === undefined ? undefined : normalizeBaseUrl(baseRaw);
  if (baseRaw === undefined) {
    problems.push('WARDBOARD_BASE_URL is required and must be an absolute http: or https: URL');
  } else if (baseUrl === undefined) {
    problems.push('WARDBOARD_BASE_URL must be an absolute http: or https: URL');
  }

  const portRaw = env['WARDBOARD_PORT'];
  let port = 8080;
  if (portRaw !== undefined) {
    const parsed = parsePort(portRaw);
    if (parsed === undefined) {
      problems.push('WARDBOARD_PORT must be an integer from 0 to 65535');
    } else {
      port = parsed;
    }
  }

  const hostRaw = env['WARDBOARD_HOST'];
  let host = '127.0.0.1';
  if (hostRaw !== undefined) {
    if (hostRaw.length === 0) {
      problems.push('WARDBOARD_HOST must not be empty');
    } else {
      host = hostRaw;
    }
  }

  const webDir = env['WARDBOARD_WEB_DIR'];
  if (webDir !== undefined && !path.isAbsolute(webDir)) {
    problems.push('WARDBOARD_WEB_DIR must be an absolute path');
  }

  const trustRaw = env['WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK'];
  let trustIdentityHeadersOnNonLoopback = false;
  if (trustRaw !== undefined) {
    if (trustRaw === '1') {
      trustIdentityHeadersOnNonLoopback = true;
    } else {
      problems.push('WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK must be "1" if set');
    }
  }

  const initialRaw = env['WARDBOARD_INITIAL_ADMIN_LOGIN'];
  let initialAdminLogin: string | undefined;
  if (initialRaw !== undefined) {
    const normalized = normalizeLogin(initialRaw);
    if (normalized === undefined) {
      problems.push('WARDBOARD_INITIAL_ADMIN_LOGIN is invalid');
    } else {
      initialAdminLogin = normalized;
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  if (dataDir === undefined || baseUrl === undefined) throw new ConfigError(problems);

  let config: Config = { dataDir, baseUrl, port, host, trustIdentityHeadersOnNonLoopback };
  if (webDir !== undefined) config = { ...config, webDir };
  if (initialAdminLogin !== undefined) config = { ...config, initialAdminLogin };
  return config;
}
