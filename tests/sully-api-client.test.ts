import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import nodeFetch, { Headers, Response } from 'node-fetch';

import {
  MAX_UPSTREAM_RESPONSE_BYTES,
  SULLY_UPSTREAM_ROUTES,
  SullyApiError,
  UPSTREAM_JSON_REQUEST_TIMEOUT_MS,
  UPSTREAM_UPLOAD_REQUEST_TIMEOUT_MS,
  createSullyApiClient,
  type NodeFetch,
} from '../server/sully-api-client.js';

const TIMESTAMP = '2026-07-13T12:00:00.000Z';
const TRANSCRIPTION = {
  data: { id: 'tr_abc123', status: 'processing', created_at: TIMESTAMP, updated_at: TIMESTAMP },
};
const NOTE_CREATED = { status: 'ok', data: { noteId: 'note_abc123' }, date: TIMESTAMP };
const NOTE = {
  status: 'ok',
  data: { id: 'note_abc123', status: 'STATUS_PROCESSING' },
  date: TIMESTAMP,
};
const CODING = {
  data: { id: 'coding_abc123', status: 'processing', created_at: TIMESTAMP, updated_at: TIMESTAMP },
};
const CODING_CREATED = {
  data: { id: 'coding_abc123', status: 'complete', created_at: TIMESTAMP, updated_at: TIMESTAMP },
};
const TEXT_JSON = { data: { answer: 42 } };
const TOKEN = { token: 'stream-token' };

interface SeenRequest {
  method: string;
  url: string;
  apiKey: string | undefined;
  accountId: string | undefined;
}

async function startUpstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: URL; close: () => Promise<void> }> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: new URL(`http://127.0.0.1:${address.port}`),
    close: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

function respondJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('uses every documented upstream method/path and attaches auth once', async (t) => {
  const seen: SeenRequest[] = [];
  const timeoutDelays: number[] = [];
  const upstream = await startUpstream((request, response) => {
    seen.push({
      method: request.method ?? '',
      url: request.url ?? '',
      apiKey: request.headers['x-api-key'] as string | undefined,
      accountId: request.headers['x-account-id'] as string | undefined,
    });
    const key = `${request.method} ${request.url}`;
    const replies: Record<string, unknown> = {
      [`POST ${SULLY_UPSTREAM_ROUTES.transcriptions}`]: TRANSCRIPTION,
      [`GET ${SULLY_UPSTREAM_ROUTES.transcription('tr_abc123')}`]: TRANSCRIPTION,
      [`POST ${SULLY_UPSTREAM_ROUTES.notes}`]: NOTE_CREATED,
      [`GET ${SULLY_UPSTREAM_ROUTES.note('note_abc123')}`]: NOTE,
      [`POST ${SULLY_UPSTREAM_ROUTES.codings}`]: CODING_CREATED,
      [`GET ${SULLY_UPSTREAM_ROUTES.coding('coding_abc123')}`]: CODING,
      [`POST ${SULLY_UPSTREAM_ROUTES.textToJson}`]: TEXT_JSON,
      [`POST ${SULLY_UPSTREAM_ROUTES.streamingToken}`]: TOKEN,
    };
    respondJson(response, replies[key]);
  });
  t.after(upstream.close);

  const directory = await mkdtemp(path.join(tmpdir(), 'sully-client-'));
  const filePath = path.join(directory, 'upload.tmp');
  await writeFile(filePath, 'RIFF');
  t.after(() => rm(directory, { recursive: true, force: true }));

  const client = createSullyApiClient({
    apiUrl: upstream.url,
    apiKey: 'secret-key',
    accountId: 'account-1',
    fetch: nodeFetch,
    timers: {
      setTimeout(_callback, milliseconds) {
        timeoutDelays.push(milliseconds);
        return timeoutDelays.length;
      },
      clearTimeout: () => undefined,
    },
  });
  const context = { requestId: 'request-1' };

  await client.createTranscription(
    {
      filePath,
      upstreamFilename: 'audio.wav',
      contentType: 'audio/wav',
      language: 'en',
      dictation: false,
      multichannel: false,
    },
    context,
  );
  await client.getTranscription('tr_abc123', context);
  await client.createNote(
    {
      transcript: 'Example transcript',
      date: '2026-07-13',
      noteType: { type: 'note_style', template: 'SOAP', includeJson: false },
      language: 'en',
    },
    context,
  );
  await client.getNote('note_abc123', context);
  await client.createCoding({ text: 'Example finding' }, context);
  await client.getCoding('coding_abc123', context);
  await client.textToJson({ text: 'age 42', schema: { age: 'number' } }, context);
  await client.createStreamingToken(60, context);

  assert.deepEqual(
    seen.map(({ method, url }) => `${method} ${url}`),
    [
      'POST /v2/audio/transcriptions',
      'GET /v2/audio/transcriptions/tr_abc123',
      'POST /v1/notes',
      'GET /v1/notes/note_abc123',
      'POST /v1/codings',
      'GET /v1/codings/coding_abc123',
      'POST /v1/utils/text-to-json',
      'POST /v1/audio/transcriptions/stream/token',
    ],
  );
  for (const request of seen) {
    assert.equal(request.apiKey, 'secret-key');
    assert.equal(request.accountId, 'account-1');
  }
  assert.deepEqual(timeoutDelays, [
    UPSTREAM_UPLOAD_REQUEST_TIMEOUT_MS,
    ...Array<number>(7).fill(UPSTREAM_JSON_REQUEST_TIMEOUT_MS),
  ]);
});

test('serializes every stable note mode exactly while keeping auth server-owned', async () => {
  const bodies: unknown[] = [];
  const headers: Headers[] = [];
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'server-secret',
    accountId: 'server-account',
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      headers.push(new Headers(init?.headers));
      return new Response(JSON.stringify(NOTE_CREATED));
    },
  });
  const common = { transcript: 'Example', date: '2026-07-13', language: 'en' as const };
  const requests = [
    { ...common, noteType: { type: 'soap' as const } },
    {
      ...common,
      noteType: { type: 'note_style' as const, template: 'SOAP', includeJson: false },
    },
    {
      ...common,
      noteType: {
        type: 'note_template' as const,
        template: {
          id: 'soap-template',
          title: 'SOAP note',
          sections: [{ type: 'heading', title: 'Assessment' }],
        },
      },
    },
  ];
  for (const request of requests) {
    await client.createNote(request, { requestId: 'request-note-modes' });
  }

  assert.deepEqual(bodies, requests);
  for (const header of headers) {
    assert.equal(header.get('X-API-Key'), 'server-secret');
    assert.equal(header.get('X-Account-ID'), 'server-account');
  }
  assert.equal(JSON.stringify(bodies).includes('server-secret'), false);
});

test('rejects redirects before custom credential headers can leave approved origin', async (t) => {
  const redirectedHeaders: Array<string | undefined> = [];
  const target = await startUpstream((request, response) => {
    redirectedHeaders.push(request.headers['x-api-key'] as string | undefined);
    respondJson(response, TRANSCRIPTION);
  });
  t.after(target.close);
  const source = await startUpstream((_request, response) => {
    response.writeHead(302, { location: target.url.toString() });
    response.end();
  });
  t.after(source.close);
  const client = createSullyApiClient({
    apiUrl: source.url,
    apiKey: 'redirect-secret',
    accountId: 'redirect-account',
    fetch: nodeFetch,
  });
  await assert.rejects(
    client.getTranscription('tr_abc123', { requestId: 'req-redirect' }),
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_TRANSPORT_ERROR',
  );
  assert.deepEqual(redirectedHeaders, []);
});

test('rejects unapproved API destinations before creating a request owner', () => {
  assert.throws(
    () =>
      createSullyApiClient({
        apiUrl: new URL('https://attacker.example'),
        apiKey: 'secret',
        accountId: 'account',
        fetch: nodeFetch,
      }),
    /approved origin/,
  );
});

test('snapshots the approved API origin before request credentials are attached', async () => {
  const configuredUrl = new URL('http://127.0.0.1:3001');
  let requestedUrl = '';
  const client = createSullyApiClient({
    apiUrl: configuredUrl,
    apiKey: 'secret',
    accountId: 'account',
    fetch: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(TRANSCRIPTION));
    },
  });

  configuredUrl.hostname = 'attacker.example';
  await client.getTranscription('tr_abc123', { requestId: 'req-origin-snapshot' });

  assert.equal(requestedUrl, 'http://127.0.0.1:3001/v2/audio/transcriptions/tr_abc123');
});

test('accepts split multibyte UTF-8 and unknown provider fields', async (t) => {
  const json = JSON.stringify({ ...TRANSCRIPTION, future: 'café' });
  const bytes = Buffer.from(json);
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const upstream = await startUpstream((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write(bytes.subarray(0, split));
    response.end(bytes.subarray(split));
  });
  t.after(upstream.close);
  const client = createSullyApiClient({
    apiUrl: upstream.url,
    apiKey: 'key',
    accountId: 'account',
    fetch: nodeFetch,
  });
  const result = await client.getTranscription('tr_abc123', { requestId: 'req' });
  assert.deepEqual(result.data, TRANSCRIPTION.data);
  assert.equal(result.future, 'café');
});

test('rejects response byte cap plus one before JSON parsing', async () => {
  const body = Readable.from([Buffer.alloc(MAX_UPSTREAM_RESPONSE_BYTES), Buffer.from('x')]);
  const fetch: NodeFetch = async () => new Response(body, { status: 200 });
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch,
  });
  await assert.rejects(
    client.getTranscription('tr_abc123', { requestId: 'req-cap' }),
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_RESPONSE_TOO_LARGE',
  );
});

test('accepts valid JSON at the exact response byte cap', async () => {
  const shell = JSON.stringify({ ...TRANSCRIPTION, padding: '' });
  const padding = 'x'.repeat(MAX_UPSTREAM_RESPONSE_BYTES - Buffer.byteLength(shell));
  const exactBody = JSON.stringify({ ...TRANSCRIPTION, padding });
  assert.equal(Buffer.byteLength(exactBody), MAX_UPSTREAM_RESPONSE_BYTES);
  const fetch: NodeFetch = async () => new Response(Readable.from([Buffer.from(exactBody)]));
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch,
  });
  const result = await client.getTranscription('tr_abc123', { requestId: 'req-exact-cap' });
  assert.equal(result.padding, padding);
});

test('normalizes HTTP, invalid JSON, invalid shape, and unknown transport failures', async () => {
  const scenarios: Array<{ fetch: NodeFetch; code: string }> = [
    ...[400, 401, 404, 429, 500].map((status) => ({
      fetch: async () => new Response('{}', { status }),
      code: 'UPSTREAM_HTTP_ERROR',
    })),
    { fetch: async () => new Response('{', { status: 200 }), code: 'UPSTREAM_INVALID_RESPONSE' },
    { fetch: async () => new Response('{}', { status: 200 }), code: 'UPSTREAM_INVALID_RESPONSE' },
    { fetch: async () => Promise.reject('socket failed'), code: 'UPSTREAM_TRANSPORT_ERROR' },
  ];
  for (const scenario of scenarios) {
    const client = createSullyApiClient({
      apiUrl: new URL('http://127.0.0.1:3001'),
      apiKey: 'secret-never-exposed',
      accountId: 'account-never-exposed',
      fetch: scenario.fetch,
    });
    await assert.rejects(
      client.getTranscription('tr_abc123', { requestId: 'req-errors' }),
      (error: unknown) => {
        assert(error instanceof SullyApiError);
        assert.equal(error.code, scenario.code);
        assert(!error.message.includes('secret-never-exposed'));
        return true;
      },
    );
  }
});

test('rejects pre-aborted requests without calling fetch', async () => {
  let calls = 0;
  const fetch: NodeFetch = async () => {
    calls += 1;
    return new Response();
  };
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.getTranscription('tr_abc123', { requestId: 'req-abort', signal: controller.signal }),
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_ABORTED',
  );
  assert.equal(calls, 0);
});

test('caller abort wins when upstream fetch ignores its signal and resolves late', async () => {
  let resolveFetch: ((response: Response) => void) | undefined;
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch: async () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  });
  const controller = new AbortController();
  const request = client.getTranscription('tr_abc123', {
    requestId: 'req-late-abort',
    signal: controller.signal,
  });
  controller.abort();
  resolveFetch?.(new Response(JSON.stringify(TRANSCRIPTION)));

  await assert.rejects(
    request,
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_ABORTED',
  );
});

test('timeout aborts transport and clears its timer', async () => {
  let timeoutCallback: (() => void) | undefined;
  let clearCalls = 0;
  let abortCalls = 0;
  const fetch: NodeFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        abortCalls += 1;
        reject(new Error('aborted'));
      });
    });
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch,
    timers: {
      setTimeout(callback) {
        timeoutCallback = callback;
        return 1;
      },
      clearTimeout() {
        clearCalls += 1;
      },
    },
  });
  const request = client.getTranscription('tr_abc123', { requestId: 'req-timeout' });
  assert(timeoutCallback);
  timeoutCallback();
  await assert.rejects(
    request,
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_TIMEOUT',
  );
  assert.equal(abortCalls, 1);
  assert.equal(clearCalls, 1);
});

test('timeout wins when upstream fetch ignores its signal and resolves late', async () => {
  let timeoutCallback: (() => void) | undefined;
  let resolveFetch: ((response: Response) => void) | undefined;
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch: async () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    timers: {
      setTimeout(callback) {
        timeoutCallback = callback;
        return 1;
      },
      clearTimeout() {},
    },
  });
  const request = client.getTranscription('tr_abc123', { requestId: 'req-late-timeout' });
  timeoutCallback?.();
  resolveFetch?.(new Response(JSON.stringify(TRANSCRIPTION)));

  await assert.rejects(
    request,
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_TIMEOUT',
  );
});

test('caller abort while pending aborts transport and clears its timer', async () => {
  let clearCalls = 0;
  let abortCalls = 0;
  const fetch: NodeFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        abortCalls += 1;
        reject(new Error('aborted'));
      });
    });
  const client = createSullyApiClient({
    apiUrl: new URL('http://127.0.0.1:3001'),
    apiKey: 'key',
    accountId: 'account',
    fetch,
    timers: {
      setTimeout: () => 1,
      clearTimeout: () => {
        clearCalls += 1;
      },
    },
  });
  const controller = new AbortController();
  const request = client.getTranscription('tr_abc123', {
    requestId: 'req-caller-abort',
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    request,
    (error: unknown) => error instanceof SullyApiError && error.code === 'UPSTREAM_ABORTED',
  );
  assert.equal(abortCalls, 1);
  assert.equal(clearCalls, 1);
});

test('destroys outbound upload stream once on every exit path', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sully-stream-lifecycle-'));
  const filePath = path.join(directory, 'upload.tmp');
  await writeFile(filePath, 'RIFF');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = {
    filePath,
    upstreamFilename: 'audio.wav',
    contentType: 'audio/wav',
    language: 'en',
    dictation: false,
    multichannel: false,
  };

  async function runScenario(
    createFetch: (onAbort: () => void) => NodeFetch,
    trigger?: (state: { timeout?: () => void; controller: AbortController }) => void,
  ): Promise<void> {
    let destroyCalls = 0;
    let timeoutCallback: (() => void) | undefined;
    let abortCalls = 0;
    const createFileStream = (): ReadStream => {
      const stream = createReadStream(filePath);
      const destroy = stream.destroy.bind(stream);
      stream.destroy = (error?: Error) => {
        destroyCalls += 1;
        return destroy(error);
      };
      return stream;
    };
    const client = createSullyApiClient({
      apiUrl: new URL('http://127.0.0.1:3001'),
      apiKey: 'key',
      accountId: 'account',
      fetch: createFetch(() => {
        abortCalls += 1;
      }),
      createFileStream,
      timers: {
        setTimeout(callback) {
          timeoutCallback = callback;
          return 1;
        },
        clearTimeout() {},
      },
    });
    const controller = new AbortController();
    const request = client.createTranscription(input, {
      requestId: 'req-stream-exit',
      signal: controller.signal,
    });
    trigger?.({ timeout: timeoutCallback, controller });
    await request.catch(() => undefined);
    assert.equal(destroyCalls, 1);
    if (trigger) assert.equal(abortCalls, 1);
  }

  await runScenario(() => async () => new Response(JSON.stringify(TRANSCRIPTION)));
  await runScenario(() => async () => new Response('{}', { status: 500 }));
  await runScenario(() => () => {
    throw new Error('synchronous fetch failure');
  });
  await runScenario(
    (onAbort) => async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          onAbort();
          reject(new Error('aborted'));
        });
      }),
    ({ controller }) => controller.abort(),
  );
  await runScenario(
    (onAbort) => async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          onAbort();
          reject(new Error('aborted'));
        });
      }),
    ({ timeout }) => timeout?.(),
  );
});
