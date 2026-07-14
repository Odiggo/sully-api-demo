import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_JSON_REQUEST_TIMEOUT_MS,
  PlaygroundApiError,
  createPlaygroundApi,
  type BrowserFetch,
} from '../browser/playground-api.js';

test('rejects malformed local API success data', async () => {
  const fetch: BrowserFetch = async () =>
    new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 });
  const api = createPlaygroundApi({ fetch });
  await assert.rejects(
    api.getTranscription('tr_abc123'),
    (error: unknown) => error instanceof PlaygroundApiError && error.code === 'LOCAL_API_INVALID_RESPONSE',
  );
});

test('rejects a pre-aborted request before fetch', async () => {
  let calls = 0;
  const fetch: BrowserFetch = async () => {
    calls += 1;
    return new Response();
  };
  const api = createPlaygroundApi({ fetch });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api.getHealth(controller.signal),
    (error: unknown) => error instanceof PlaygroundApiError && error.code === 'LOCAL_API_ABORTED',
  );
  assert.equal(calls, 0);
});

test('aborts a local fetch at exact deadline and clears timer', async () => {
  let timeoutCallback: (() => void) | undefined;
  let abortCalls = 0;
  let clearCalls = 0;
  let seenDelay = 0;
  const fetch: BrowserFetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        abortCalls += 1;
        reject(new Error('aborted'));
      });
    });
  const api = createPlaygroundApi({
    fetch,
    timers: {
      setTimeout(callback, milliseconds) {
        timeoutCallback = callback;
        seenDelay = milliseconds;
        return 1;
      },
      clearTimeout() {
        clearCalls += 1;
      },
    },
  });
  const request = api.getHealth();
  assert.equal(seenDelay, LOCAL_JSON_REQUEST_TIMEOUT_MS);
  timeoutCallback?.();
  await assert.rejects(
    request,
    (error: unknown) => error instanceof PlaygroundApiError && error.code === 'LOCAL_API_TIMEOUT',
  );
  assert.equal(abortCalls, 1);
  assert.equal(clearCalls, 1);
});

test('preserves stable server error while rejecting malformed error bodies', async () => {
  const stableFetch: BrowserFetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: 'SETUP_REQUIRED', message: 'Configure credentials', requestId: 'request-1' },
      }),
      { status: 503 },
    );
  const stableApi = createPlaygroundApi({ fetch: stableFetch });
  await assert.rejects(stableApi.getHealth(), (error: unknown) => {
    assert(error instanceof PlaygroundApiError);
    assert.equal(error.code, 'SETUP_REQUIRED');
    assert.equal(error.requestId, 'request-1');
    return true;
  });

  const malformedApi = createPlaygroundApi({
    fetch: async () => new Response('<private upstream body>', { status: 500 }),
  });
  await assert.rejects(malformedApi.getHealth(), (error: unknown) => {
    assert(error instanceof PlaygroundApiError);
    assert.equal(error.code, 'LOCAL_API_HTTP_ERROR');
    assert(!error.message.includes('private upstream body'));
    return true;
  });
});

test('loads only a non-empty bounded WAV sample', async () => {
  const validApi = createPlaygroundApi({
    fetch: async () => new Response(new Blob(['RIFF'], { type: 'audio/wav' })),
  });
  const file = await validApi.loadSampleAudio();
  assert.equal(file.name, 'demo-audio.wav');
  assert.equal(file.type, 'audio/wav');
  assert.equal(file.size, 4);

  for (const body of [
    new Blob([], { type: 'audio/wav' }),
    new Blob(['text'], { type: 'text/plain' }),
  ]) {
    const api = createPlaygroundApi({ fetch: async () => new Response(body) });
    await assert.rejects(api.loadSampleAudio(), /sample audio/i);
  }
});

test('uses every local workflow route and validates documented responses', async () => {
  const timestamp = '2026-07-13T12:00:00.000Z';
  const calls: Array<{ method: string; path: string }> = [];
  const responses: Record<string, unknown> = {
    'GET /health': { ok: true, missing: [], invalid: [] },
    'POST /api/streaming-token': {
      token: 'token',
      apiUrl: 'https://api-testing.sully.ai/v1',
      accountId: 'account',
    },
    'POST /api/transcriptions': {
      data: { id: 'tr_abc123', status: 'processing', created_at: timestamp, updated_at: timestamp },
    },
    'GET /api/transcriptions/tr_abc123': {
      data: { id: 'tr_abc123', status: 'processing', created_at: timestamp, updated_at: timestamp },
    },
    'POST /api/notes': { status: 'ok', data: { noteId: 'note_abc123' }, date: timestamp },
    'GET /api/notes/note_abc123': {
      status: 'ok',
      data: { id: 'note_abc123', status: 'STATUS_PROCESSING' },
      date: timestamp,
    },
    'POST /api/codings': {
      data: { id: 'coding_abc123', status: 'processing', created_at: timestamp, updated_at: timestamp },
    },
    'GET /api/codings/coding_abc123': {
      data: { id: 'coding_abc123', status: 'processing', created_at: timestamp, updated_at: timestamp },
    },
    'POST /api/text-to-json': { data: { age: 42 } },
  };
  const fetch: BrowserFetch = async (input, init) => {
    const path = input.toString();
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    return new Response(JSON.stringify(responses[`${method} ${path}`]), { status: 200 });
  };
  const api = createPlaygroundApi({ fetch });
  await api.getHealth();
  await api.createStreamingToken(60);
  await api.createTranscription(new FormData());
  await api.getTranscription('tr_abc123');
  await api.createNote({
    transcript: 'Example',
    date: '2026-07-13',
    language: 'en',
    noteType: { type: 'note_style', template: 'SOAP', includeJson: false },
  });
  await api.getNote('note_abc123');
  await api.createCoding({ text: 'Finding' });
  await api.getCoding('coding_abc123');
  await api.textToJson({ text: 'age 42', schema: { age: 'number' } });
  assert.deepEqual(calls, [
    { method: 'GET', path: '/health' },
    { method: 'POST', path: '/api/streaming-token' },
    { method: 'POST', path: '/api/transcriptions' },
    { method: 'GET', path: '/api/transcriptions/tr_abc123' },
    { method: 'POST', path: '/api/notes' },
    { method: 'GET', path: '/api/notes/note_abc123' },
    { method: 'POST', path: '/api/codings' },
    { method: 'GET', path: '/api/codings/coding_abc123' },
    { method: 'POST', path: '/api/text-to-json' },
  ]);
});
