import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { get, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { Express } from 'express';
import NodeFormData from 'form-data';
import nodeFetch from 'node-fetch';

import {
  MAX_AUDIO_FILE_BYTES,
  apiErrorSchema,
  type CodingRequest,
  type NoteRequest,
  type TextToJsonRequest,
} from '../contracts/index.js';
import { createServerApp } from '../server/server-app.js';
import { SullyApiError, type SullyApiClient, type TranscriptionUpload } from '../server/sully-api-client.js';
import type { ServerConfig } from '../server/server-config.js';
import type { DemoLogEvent, DemoLogger } from '../server/demo-logger.js';

const ROOT_DIRECTORY = process.cwd();
const TIMESTAMP = '2026-07-13T12:00:00.000Z';
const TRANSCRIPTION = {
  data: { id: 'tr_abc123', status: 'processing' as const, created_at: TIMESTAMP, updated_at: TIMESTAMP },
};
const NOTE_CREATED = { status: 'ok' as const, data: { noteId: 'note_abc123' }, date: TIMESTAMP };
const NOTE = {
  status: 'ok' as const,
  data: { id: 'note_abc123', status: 'STATUS_PROCESSING' as const },
  date: TIMESTAMP,
};
const CODING = {
  data: {
    id: 'coding_abc123',
    status: 'processing' as const,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  },
};

const READY_CONFIG: ServerConfig = {
  port: 3000,
  openBrowser: false,
  credentials: {
    ready: true,
    apiUrl: new URL('https://api-testing.sully.ai'),
    apiKey: 'route-secret-key',
    accountId: 'route-account',
  },
};

const NOT_READY_CONFIG: ServerConfig = {
  port: 3000,
  openBrowser: false,
  credentials: { ready: false, missing: ['SULLY_API_KEY'], invalid: [] },
};

interface FakeClientState {
  calls: string[];
  upload?: TranscriptionUpload;
}

function createFakeClient(
  state: FakeClientState,
  overrides: Partial<SullyApiClient> = {},
): SullyApiClient {
  return {
    async createTranscription(input) {
      state.calls.push('createTranscription');
      state.upload = input;
      return TRANSCRIPTION;
    },
    async getTranscription() {
      state.calls.push('getTranscription');
      return TRANSCRIPTION;
    },
    async createNote(_input: NoteRequest) {
      state.calls.push('createNote');
      return NOTE_CREATED;
    },
    async getNote() {
      state.calls.push('getNote');
      return NOTE;
    },
    async createCoding(_input: CodingRequest) {
      state.calls.push('createCoding');
      return CODING;
    },
    async getCoding() {
      state.calls.push('getCoding');
      return CODING;
    },
    async textToJson(_input: TextToJsonRequest) {
      state.calls.push('textToJson');
      return { data: { answer: 42 } };
    },
    async createStreamingToken() {
      state.calls.push('createStreamingToken');
      return { token: 'stream-token' };
    },
    ...overrides,
  };
}

async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

async function createHarness(options: {
  config?: ServerConfig;
  client?: SullyApiClient;
  logger?: DemoLogger;
  uploadDirectory?: string;
  removeUploadFile?: (filePath: string) => Promise<void>;
} = {}) {
  const state: FakeClientState = { calls: [] };
  const events: DemoLogEvent[] = [];
  const logger: DemoLogger = {
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
  };
  const parent = await mkdtemp(path.join(tmpdir(), 'sully-routes-'));
  const uploadDirectory = options.uploadDirectory ?? path.join(parent, 'uploads');
  let requestNumber = 0;
  const app = await createServerApp({
    config: options.config ?? READY_CONFIG,
    client: options.client ?? createFakeClient(state),
    logger: options.logger ?? logger,
    uploadDirectory,
    rootDirectory: ROOT_DIRECTORY,
    createRequestId: () => `request-${++requestNumber}`,
    removeUploadFile: options.removeUploadFile,
  });
  const server = await listen(app);
  return {
    ...server,
    state,
    events,
    uploadDirectory,
    close: async () => {
      await server.close();
      await rm(parent, { recursive: true, force: true });
    },
  };
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function requestWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { Host: host } }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
  });
}

test('keeps setup UI available while blocking APIs without credentials', async (t) => {
  const harness = await createHarness({ config: NOT_READY_CONFIG });
  t.after(harness.close);
  const root = await fetch(`${harness.url}/`);
  const health = await fetch(`${harness.url}/health`);
  const api = await fetch(`${harness.url}/api/codings`, jsonRequest({ text: 'finding' }));
  assert.equal(root.status, 200);
  assert.deepEqual(await health.json(), {
    ok: false,
    missing: ['SULLY_API_KEY'],
    invalid: [],
  });
  assert.equal(api.status, 503);
  assert(!JSON.stringify(await api.json()).includes('route-secret-key'));
});

test('rejects hostile Host, Origin, and fetch-site before client use', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  assert.equal(await requestWithHost(`${harness.url}/health`, 'attacker.example'), 403);
  const hostileHeaders: Array<Record<string, string>> = [
    { Origin: 'https://attacker.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of hostileHeaders) {
    const response = await fetch(`${harness.url}/api/text-to-json`, {
      ...jsonRequest({ text: 'age 42', schema: { age: 'number' } }),
      headers: { 'content-type': 'application/json', ...headers },
    });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(harness.state.calls, []);

  const allowed = await fetch(
    `${harness.url}/api/text-to-json`,
    jsonRequest({ text: 'age 42', schema: { age: 'number' } }),
  );
  assert.equal(allowed.status, 200);
});

test('serves only explicit public assets and denies repository files', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  for (const publicPath of ['/', '/logo-192x192.png', '/samples/demo-audio.wav', '/audio-worklet/pcm-audio-worklet.min.js']) {
    assert.equal((await fetch(`${harness.url}${publicPath}`)).status, 200, publicPath);
  }
  for (const deniedPath of [
    '/.env',
    '/package.json',
    '/server.ts',
    '/pnpm-lock.yaml',
    '/contracts/index.ts',
    '/assets/server.js',
    '/node_modules/@speechmatics/browser-audio-input/dist/index.js',
  ]) {
    assert.equal((await fetch(`${harness.url}${deniedPath}`)).status, 404, deniedPath);
  }
});

test('sets browser security and no-store headers without credentials', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  for (const endpoint of ['/', '/health']) {
    const response = await fetch(`${harness.url}${endpoint}`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const headers = JSON.stringify(Object.fromEntries(response.headers));
    assert(!headers.includes('route-secret-key'));
    assert(!headers.includes('route-account'));
  }
  const policy = (await fetch(`${harness.url}/`)).headers.get('content-security-policy') ?? '';
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /https:\/\/api-testing\.sully\.ai/);
  assert.match(policy, /wss:\/\/api-testing\.sully\.ai/);
});

test('maps all JSON workflow routes and rejects invalid IDs and bodies', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const requests: Array<[string, RequestInit | undefined, string]> = [
    ['/api/streaming-token', jsonRequest({ expiresIn: 60 }), 'createStreamingToken'],
    ['/api/transcriptions/tr_abc123', undefined, 'getTranscription'],
    ['/api/notes', jsonRequest({ transcript: 'Example', date: '2026-07-13', language: 'en', noteType: { type: 'note_style', template: 'SOAP', includeJson: false } }), 'createNote'],
    ['/api/notes/note_abc123', undefined, 'getNote'],
    ['/api/codings', jsonRequest({ text: 'Finding' }), 'createCoding'],
    ['/api/codings/coding_abc123', undefined, 'getCoding'],
    ['/api/text-to-json', jsonRequest({ text: 'age 42', schema: { age: 'number' } }), 'textToJson'],
  ];
  for (const [route, init, expectedCall] of requests) {
    const response = await fetch(`${harness.url}${route}`, init);
    assert.equal(response.status, 200, route);
    assert.equal(harness.state.calls.at(-1), expectedCall);
  }
  const callsBeforeInvalid = harness.state.calls.length;
  assert.equal((await fetch(`${harness.url}/api/codings/not-valid`)).status, 400);
  assert.equal((await fetch(`${harness.url}/api/codings`, jsonRequest({ text: ' ' }))).status, 400);
  assert.equal((await fetch(`${harness.url}/api/codings`, jsonRequest({ text: 'Finding', extra: true }))).status, 400);
  assert.equal(
    (
      await fetch(`${harness.url}/api/codings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  );
  assert.equal((await fetch(`${harness.url}/api/streaming-token`, jsonRequest({ expiresIn: 59 }))).status, 400);
  assert.equal(harness.state.calls.length, callsBeforeInvalid);
});

test('bounds JSON bodies and returns browser-safe streaming credentials only', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const oversized = await fetch(`${harness.url}/api/codings`, jsonRequest({ text: 'x'.repeat(65_537) }));
  assert.equal(oversized.status, 413);

  const streaming = await fetch(
    `${harness.url}/api/streaming-token`,
    jsonRequest({ expiresIn: 60 }),
  );
  assert.equal(streaming.status, 200);
  const body = await streaming.json();
  assert.deepEqual(body, {
    token: 'stream-token',
    apiUrl: 'https://api-testing.sully.ai/v1',
    accountId: 'route-account',
  });
  assert(!JSON.stringify(body).includes('route-secret-key'));
});

test('forwards exact multipart booleans, hides original filename, and removes temp file', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const form = new FormData();
  form.append('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'patient-name.wav');
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');
  const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
  const responseBody = await response.text();
  assert.equal(response.status, 200, responseBody);
  assert.equal(harness.state.upload?.dictation, false);
  assert.equal(harness.state.upload?.multichannel, false);
  assert.equal(harness.state.upload?.upstreamFilename, 'audio.wav');
  assert(!JSON.stringify(harness.state.upload).includes('patient-name'));
  assert.deepEqual(await readdir(harness.uploadDirectory), []);
});

test('accepts every documented audio MIME and extension pair', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const audioTypes = [
    ['audio/wav', 'wav'],
    ['audio/mpeg', 'mp3'],
    ['audio/flac', 'flac'],
    ['audio/ogg', 'ogg'],
    ['audio/webm', 'webm'],
    ['video/mp4', 'mp4'],
    ['audio/x-m4a', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/opus', 'opus'],
  ];
  for (const [mimeType, extension] of audioTypes) {
    const form = new FormData();
    form.append('audio', new Blob(['x'], { type: mimeType }), `sample.${extension}`);
    form.append('language', 'en');
    form.append('dictation', 'true');
    form.append('multichannel', 'false');
    const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
    assert.equal(response.status, 200, `${mimeType} .${extension}`);
    assert.equal(harness.state.upload?.upstreamFilename, `audio.${extension}`);
  }
  assert.deepEqual(await readdir(harness.uploadDirectory), []);
});

test('rejects missing, empty, duplicate, excess, malformed, and unsupported upload input', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const createBaseForm = () => {
    const form = new FormData();
    form.append('language', 'en');
    form.append('dictation', 'false');
    form.append('multichannel', 'false');
    return form;
  };
  const scenarios: FormData[] = [];
  scenarios.push(createBaseForm());
  const empty = createBaseForm();
  empty.append('audio', new Blob([], { type: 'audio/wav' }), 'empty.wav');
  scenarios.push(empty);
  const duplicate = createBaseForm();
  duplicate.append('audio', new Blob(['a'], { type: 'audio/wav' }), 'a.wav');
  duplicate.append('audio', new Blob(['b'], { type: 'audio/wav' }), 'b.wav');
  scenarios.push(duplicate);
  const excess = createBaseForm();
  excess.append('audio', new Blob(['a'], { type: 'audio/wav' }), 'a.wav');
  excess.append('extra', 'not allowed');
  scenarios.push(excess);
  const malformed = new FormData();
  malformed.append('audio', new Blob(['a'], { type: 'audio/wav' }), 'a.wav');
  malformed.append('language', 'en');
  malformed.append('dictation', 'False');
  malformed.append('multichannel', 'false');
  scenarios.push(malformed);
  const unsupported = createBaseForm();
  unsupported.append('audio', new Blob(['a'], { type: 'application/octet-stream' }), 'a.exe');
  scenarios.push(unsupported);

  for (const form of scenarios) {
    const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
    assert(response.status >= 400 && response.status < 500, await response.text());
  }
  assert.deepEqual(harness.state.calls, []);
  assert.deepEqual(await readdir(harness.uploadDirectory), []);
});

async function postGeneratedAudio(url: string, size: number): Promise<number> {
  const form = new NodeFormData();
  async function* bytes() {
    const chunk = Buffer.alloc(64 * 1024, 1);
    let remaining = size;
    while (remaining > 0) {
      const count = Math.min(remaining, chunk.byteLength);
      yield chunk.subarray(0, count);
      remaining -= count;
    }
  }
  form.append('audio', Readable.from(bytes()), {
    filename: 'audio.wav',
    contentType: 'audio/wav',
    knownLength: size,
  });
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');
  const response = await nodeFetch(url, { method: 'POST', body: form });
  return response.status;
}

test('accepts exact maximum upload and rejects maximum plus one', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  assert.equal(
    await postGeneratedAudio(`${harness.url}/api/transcriptions`, MAX_AUDIO_FILE_BYTES),
    200,
  );
  assert.equal(
    await postGeneratedAudio(`${harness.url}/api/transcriptions`, MAX_AUDIO_FILE_BYTES + 1),
    413,
  );
  assert.deepEqual(await readdir(harness.uploadDirectory), []);
});

test('removes temporary upload after every upstream failure class', async () => {
  const scenarios = [
    { code: 'UPSTREAM_HTTP_ERROR' as const, status: 502 },
    { code: 'UPSTREAM_INVALID_RESPONSE' as const, status: 502 },
    { code: 'UPSTREAM_TRANSPORT_ERROR' as const, status: 502 },
    { code: 'UPSTREAM_TIMEOUT' as const, status: 504 },
  ];
  for (const scenario of scenarios) {
    const state: FakeClientState = { calls: [] };
    const client = createFakeClient(state, {
      async createTranscription(_input, context) {
        throw new SullyApiError(scenario.code, context.requestId, 500);
      },
    });
    const harness = await createHarness({ client });
    try {
      const form = new FormData();
      form.append('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'sample.wav');
      form.append('language', 'en');
      form.append('dictation', 'false');
      form.append('multichannel', 'false');
      const response = await fetch(`${harness.url}/api/transcriptions`, {
        method: 'POST',
        body: form,
      });
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await readdir(harness.uploadDirectory), []);
    } finally {
      await harness.close();
    }
  }
});

test('aborts upstream work and removes upload when browser disconnects', async (t) => {
  const state: FakeClientState = { calls: [] };
  let markStarted: (() => void) | undefined;
  let markAborted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const client = createFakeClient(state, {
    async createTranscription(_input, context) {
      markStarted?.();
      return new Promise((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => {
          markAborted?.();
          reject(new SullyApiError('UPSTREAM_ABORTED', context.requestId));
        });
      });
    },
  });
  const harness = await createHarness({ client });
  t.after(harness.close);
  const form = new NodeFormData();
  form.append('audio', Buffer.from('RIFF'), { filename: 'audio.wav', contentType: 'audio/wav' });
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');
  const target = new URL('/api/transcriptions', harness.url);
  const request = httpRequest(target, { method: 'POST', headers: form.getHeaders() });
  request.on('error', () => undefined);
  form.pipe(request);
  await started;
  request.destroy();
  await aborted;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readdir(harness.uploadDirectory)).length === 0) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(await readdir(harness.uploadDirectory), []);
});

test('cleanup failure preserves successful upstream creation and logs no generated path', async (t) => {
  const attemptedPaths: string[] = [];
  const harness = await createHarness({
    removeUploadFile: async (filePath) => {
      attemptedPaths.push(filePath);
      throw new Error(`unable to remove ${filePath}`);
    },
  });
  t.after(harness.close);
  const form = new FormData();
  form.append('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'sample.wav');
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');
  const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
  const serialized = JSON.stringify(await response.json());
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(serialized), TRANSCRIPTION);
  assert.equal(attemptedPaths.length, 1);
  assert(JSON.stringify(harness.events).includes('upload_cleanup_failed'));
  assert(!serialized.includes(attemptedPaths[0]));
  assert(!serialized.includes('sample.wav'));
  assert(!JSON.stringify(harness.events).includes(attemptedPaths[0]));
});

test('cleanup logger failure cannot replace successful upstream creation', async (t) => {
  const harness = await createHarness({
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger failed');
      },
    },
    removeUploadFile: async () => {
      throw new Error('cleanup failed');
    },
  });
  t.after(harness.close);
  const form = new FormData();
  form.append('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'sample.wav');
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');

  const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), TRANSCRIPTION);
});

test('cleanup failure preserves primary upstream failure', async (t) => {
  const client = createFakeClient(
    { calls: [] },
    {
      async createTranscription() {
        throw new SullyApiError('UPSTREAM_TIMEOUT', 'request-primary');
      },
    },
  );
  const harness = await createHarness({
    client,
    removeUploadFile: async () => {
      throw new Error('cleanup failed');
    },
  });
  t.after(harness.close);
  const form = new FormData();
  form.append('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'sample.wav');
  form.append('language', 'en');
  form.append('dictation', 'false');
  form.append('multichannel', 'false');

  const response = await fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
  const body = apiErrorSchema.parse(await response.json());
  assert.equal(response.status, 504);
  assert.equal(body.error.code, 'UPSTREAM_TIMEOUT');
  assert(JSON.stringify(harness.events).includes('upload_cleanup_failed'));
});

test('creates missing upload directory before concurrent first requests', async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'sully-missing-upload-'));
  const missingDirectory = path.join(parent, 'nested', 'uploads');
  const harness = await createHarness({ uploadDirectory: missingDirectory });
  t.after(async () => {
    await harness.close();
    await rm(parent, { recursive: true, force: true });
  });
  const upload = (value: string) => {
    const form = new FormData();
    form.append('audio', new Blob([value], { type: 'audio/wav' }), `${value}.wav`);
    form.append('language', 'en');
    form.append('dictation', 'false');
    form.append('multichannel', 'false');
    return fetch(`${harness.url}/api/transcriptions`, { method: 'POST', body: form });
  };
  const responses = await Promise.all([upload('a'), upload('b')]);
  const results = await Promise.all(
    responses.map(async (response) => ({ status: response.status, body: await response.text() })),
  );
  assert.deepEqual(results, [
    { status: 200, body: JSON.stringify(TRANSCRIPTION) },
    { status: 200, body: JSON.stringify(TRANSCRIPTION) },
  ]);
  assert.deepEqual(await readdir(missingDirectory), []);
});

test('normalizes upstream failures and logs metadata without clinical data', async (t) => {
  const state: FakeClientState = { calls: [] };
  const client = createFakeClient(state, {
    async createCoding(_input, context) {
      throw new SullyApiError('UPSTREAM_HTTP_ERROR', context.requestId, 429);
    },
  });
  const harness = await createHarness({ client });
  t.after(harness.close);
  const clinicalText = 'private patient finding';
  const response = await fetch(`${harness.url}/api/codings`, jsonRequest({ text: clinicalText }));
  assert.equal(response.status, 502);
  const serialized = JSON.stringify({ body: await response.json(), events: harness.events });
  assert(!serialized.includes(clinicalText));
  assert(!serialized.includes('route-secret-key'));
  assert(!serialized.includes('route-account'));
  assert.match(serialized, /request-1/);
});
