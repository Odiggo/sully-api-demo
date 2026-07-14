import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PORT,
  loadServerConfig,
  parseServerConfig,
  toHealthResponse,
} from '../server/server-config.js';

const validCredentials = {
  SULLY_API_URL: 'https://api.sully.ai',
  SULLY_API_KEY: 'key',
  SULLY_ACCOUNT_ID: 'account',
};

describe('parseServerConfig credentials', () => {
  test('classifies missing, blank, whitespace, and null-like credentials without values', () => {
    for (const value of [undefined, '', ' ', '\t', 'null', 'undefined']) {
      const parsed = parseServerConfig({
        SULLY_API_URL: value,
        SULLY_API_KEY: value,
        SULLY_ACCOUNT_ID: value,
      });

      assert.deepEqual(parsed.credentials, {
        ready: false,
        missing: ['SULLY_API_URL', 'SULLY_API_KEY', 'SULLY_ACCOUNT_ID'],
        invalid: [],
      });
    }
  });

  test('rejects malformed, credentialed, endpoint, and insecure remote URLs', () => {
    const invalidUrls = [
      'not-a-url',
      'ftp://api.sully.ai',
      'http://api.sully.ai',
      'https://attacker.example',
      'https://api.sully.ai:444',
      'https://user:pass@api.sully.ai',
      'https://api.sully.ai/v1',
      'https://api.sully.ai?region=us',
      'https://api.sully.ai#fragment',
    ];

    for (const apiUrl of invalidUrls) {
      const parsed = parseServerConfig({ ...validCredentials, SULLY_API_URL: apiUrl });
      assert.deepEqual(parsed.credentials, {
        ready: false,
        missing: [],
        invalid: ['SULLY_API_URL'],
      });
    }
  });

  test('accepts HTTPS and loopback HTTP origins and normalizes trailing slash', () => {
    for (const apiUrl of [
      'https://api.sully.ai/',
      'http://127.0.0.1:4010',
      'http://localhost:4010/',
      'http://[::1]:4010',
    ]) {
      const parsed = parseServerConfig({ ...validCredentials, SULLY_API_URL: apiUrl });
      assert.equal(parsed.credentials.ready, true);
      if (parsed.credentials.ready) {
        assert.equal(parsed.credentials.apiUrl.pathname, '/');
        assert.equal(parsed.credentials.apiUrl.search, '');
        assert.equal(parsed.credentials.apiUrl.hash, '');
      }
    }
  });

  test('health contains credential names only and is coherent with readiness', () => {
    assert.deepEqual(toHealthResponse(parseServerConfig(validCredentials)), {
      ok: true,
      missing: [],
      invalid: [],
    });

    const health = toHealthResponse(parseServerConfig({ SULLY_API_KEY: 'secret-value' }));
    assert.deepEqual(health, {
      ok: false,
      missing: ['SULLY_API_URL', 'SULLY_ACCOUNT_ID'],
      invalid: [],
    });
    assert.equal(JSON.stringify(health).includes('secret-value'), false);
  });
});

describe('parseServerConfig operational values', () => {
  test('defaults port and browser opening only when absent', () => {
    const parsed = parseServerConfig(validCredentials);
    assert.equal(parsed.port, DEFAULT_PORT);
    assert.equal(parsed.openBrowser, true);
  });

  test('accepts exact TCP port boundaries and exact browser booleans', () => {
    assert.equal(parseServerConfig({ ...validCredentials, PORT: '1' }).port, 1);
    assert.equal(parseServerConfig({ ...validCredentials, PORT: '65535' }).port, 65_535);
    assert.equal(
      parseServerConfig({ ...validCredentials, SULLY_DEMO_OPEN_BROWSER: 'true' }).openBrowser,
      true,
    );
    assert.equal(
      parseServerConfig({ ...validCredentials, SULLY_DEMO_OPEN_BROWSER: 'false' }).openBrowser,
      false,
    );
  });

  test('rejects empty, whitespace, malformed, and out-of-range ports', () => {
    for (const port of ['', ' ', '0', '-1', '1.5', '1e3', 'NaN', 'null', 'undefined', '65536']) {
      assert.throws(() => parseServerConfig({ ...validCredentials, PORT: port }), /PORT/);
    }
  });

  test('rejects every present non-boolean browser flag', () => {
    for (const flag of ['', ' ', 'TRUE', 'FALSE', '1', '0', 'yes', 'null']) {
      assert.throws(
        () => parseServerConfig({ ...validCredentials, SULLY_DEMO_OPEN_BROWSER: flag }),
        /SULLY_DEMO_OPEN_BROWSER/,
      );
    }
  });
});

test('loadServerConfig uses real dotenv parsing with process environment precedence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sully-config-'));
  const envPath = join(directory, '.env');
  await writeFile(
    envPath,
    [
      'SULLY_API_URL=https://api-testing.sully.ai',
      'SULLY_API_KEY=file-key',
      'SULLY_ACCOUNT_ID=file-account',
      'PORT=4100',
    ].join('\n'),
  );

  try {
    const processEnv = { SULLY_API_KEY: 'process-key', PORT: '4200' };
    const parsed = loadServerConfig({ envFilePath: envPath, processEnv });
    assert.equal(parsed.port, 4_200);
    assert.equal(parsed.credentials.ready, true);
    if (parsed.credentials.ready) {
      assert.equal(parsed.credentials.apiKey, 'process-key');
      assert.equal(parsed.credentials.accountId, 'file-account');
    }
    assert.deepEqual(processEnv, { SULLY_API_KEY: 'process-key', PORT: '4200' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loadServerConfig fails closed on dotenv blank-like values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sully-config-'));
  const envPath = join(directory, '.env');
  await writeFile(
    envPath,
    ['SULLY_API_URL=   ', 'SULLY_API_KEY=null', 'SULLY_ACCOUNT_ID=undefined'].join('\n'),
  );

  try {
    assert.deepEqual(loadServerConfig({ envFilePath: envPath, processEnv: {} }).credentials, {
      ready: false,
      missing: ['SULLY_API_URL', 'SULLY_API_KEY', 'SULLY_ACCOUNT_ID'],
      invalid: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('.env.example boots with safe defaults and missing secrets', () => {
  const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
  const parsed = loadServerConfig({ envFilePath: examplePath, processEnv: {} });

  assert.equal(parsed.port, DEFAULT_PORT);
  assert.equal(parsed.openBrowser, true);
  assert.deepEqual(parsed.credentials, {
    ready: false,
    missing: ['SULLY_API_KEY', 'SULLY_ACCOUNT_ID'],
    invalid: [],
  });
});
