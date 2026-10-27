import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/index.ts';

const validEnv = {
  WARDBOARD_DATA_DIR: '/var/lib/wardboard',
  WARDBOARD_BASE_URL: 'http://wardboard.example',
};

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('parseConfig', () => {
  it('parseConfig applies defaults', () => {
    const config = parseConfig(validEnv);

    expect(config.dataDir).toBe('/var/lib/wardboard');
    expect(config.baseUrl).toBe('http://wardboard.example');
    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.webDir).toBeUndefined();
  });

  it('parseConfig reports every problem at once', () => {
    const error = capture(() => parseConfig({ WARDBOARD_PORT: 'abc' }));

    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof ConfigError ? error.message : '';
    expect(message).toContain('WARDBOARD_DATA_DIR');
    expect(message).toContain('WARDBOARD_BASE_URL');
    expect(message).toContain('WARDBOARD_PORT');
  });

  it('parseConfig rejects a relative data dir', () => {
    const error = capture(() =>
      parseConfig({
        ...validEnv,
        WARDBOARD_DATA_DIR: 'data',
      }),
    );

    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof ConfigError ? error.message : '';
    expect(message).toContain('WARDBOARD_DATA_DIR');
  });

  it('parseConfig rejects non-http base URLs', () => {
    for (const baseUrl of ['ftp://x', 'localhost:8080', '']) {
      const error = capture(() =>
        parseConfig({
          ...validEnv,
          WARDBOARD_BASE_URL: baseUrl,
        }),
      );

      expect(error, baseUrl).toBeInstanceOf(ConfigError);
      const message = error instanceof ConfigError ? error.message : '';
      expect(message, baseUrl).toContain('WARDBOARD_BASE_URL');
    }
  });

  it('parseConfig strips a trailing slash from base URL', () => {
    const config = parseConfig({
      ...validEnv,
      WARDBOARD_BASE_URL: 'http://h/',
    });

    expect(config.baseUrl).toBe('http://h');
  });

  it('parseConfig validates port bounds and format', () => {
    expect(parseConfig({ ...validEnv, WARDBOARD_PORT: '0' }).port).toBe(0);
    expect(parseConfig({ ...validEnv, WARDBOARD_PORT: '65535' }).port).toBe(65535);

    for (const port of ['-1', '65536', '80a', '1.5', '']) {
      const error = capture(() =>
        parseConfig({
          ...validEnv,
          WARDBOARD_PORT: port,
        }),
      );

      expect(error, port).toBeInstanceOf(ConfigError);
      const message = error instanceof ConfigError ? error.message : '';
      expect(message, port).toContain('WARDBOARD_PORT');
    }
  });

  it('parseConfig keeps an absolute web dir', () => {
    const config = parseConfig({
      ...validEnv,
      WARDBOARD_WEB_DIR: '/var/lib/wardboard/web',
    });

    expect(config.webDir).toBe('/var/lib/wardboard/web');
  });

  it('parseConfig rejects a relative web dir', () => {
    const error = capture(() =>
      parseConfig({
        ...validEnv,
        WARDBOARD_WEB_DIR: 'web',
      }),
    );

    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof ConfigError ? error.message : '';
    expect(message).toContain('WARDBOARD_WEB_DIR');
  });

  it('trust flag defaults to false', () => {
    const config = parseConfig(validEnv);
    expect(config.trustIdentityHeadersOnNonLoopback).toBe(false);
  });

  it('trust flag accepts only "1"', () => {
    const config = parseConfig({
      ...validEnv,
      WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK: '1',
    });
    expect(config.trustIdentityHeadersOnNonLoopback).toBe(true);

    for (const val of ['true', '0', '', 'yes']) {
      const error = capture(() =>
        parseConfig({
          ...validEnv,
          WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK: val,
        }),
      );
      expect(error, `val: ${JSON.stringify(val)}`).toBeInstanceOf(ConfigError);
      const message = error instanceof ConfigError ? error.message : '';
      expect(message, `val: ${JSON.stringify(val)}`).toContain(
        'WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK',
      );
    }
  });
});
