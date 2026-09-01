import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocketServer, type WebSocket } from 'ws';

const repositoryRoot = new URL('../', import.meta.url);

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

async function runStreamingCli({
  apiUrl,
  mode,
  pathValue = process.env.PATH,
  onSpawn,
}: {
  apiUrl: string;
  mode: 'client' | 'server';
  pathValue?: string;
  onSpawn?: (child: ChildProcess) => void;
}): Promise<CliResult> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'sully-stream-demo.ts', '--duration', '1', '--mode', mode],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: pathValue,
        SULLY_API_URL: apiUrl,
        SULLY_API_KEY: 'test-key',
        SULLY_ACCOUNT_ID: 'test-account',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  onSpawn?.(child);
  const deadline = setTimeout(() => child.kill('SIGKILL'), 2_500);
  const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
  clearTimeout(deadline);
  return { code, signal, stderr };
}

test('client mode uses the canonical safe error contract for invalid tokens', async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: { token: 'nested-token' } }));
  });
  const apiUrl = await listen(server);
  t.after(() => server.close());

  const result = await runStreamingCli({ apiUrl, mode: 'client' });

  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /Sully API returned an invalid response/);
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function createFakeRecorder(): Promise<{ directory: string; pathValue: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sully-stream-recorder-'));
  const executable = path.join(directory, 'rec');
  await writeFile(
    executable,
    '#!/usr/bin/env node\nprocess.stdout.write(Buffer.from([1, 2, 3, 4]));\nsetInterval(() => {}, 1000);\n',
  );
  await chmod(executable, 0o755);
  return { directory, pathValue: `${directory}:${process.env.PATH ?? ''}` };
}

test('client mode accepts the canonical top-level streaming token', { timeout: 5_000 }, async (t) => {
  const recorder = await createFakeRecorder();
  t.after(() => rm(recorder.directory, { recursive: true, force: true }));
  const requests: Array<{ body: string; apiKey: string | undefined }> = [];
  const server = createServer((request: IncomingMessage, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ body, apiKey: request.headers['x-api-key'] as string | undefined });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ token: 'temporary-token' }));
    });
  });
  const sockets = new Set<WebSocket>();
  const webSockets = new WebSocketServer({ noServer: true });
  webSockets.on('connection', (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'status', status: 'connected' }));
    setTimeout(() => socket.close(), 100);
  });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request);
    });
  });
  const apiUrl = await listen(server);
  t.after(() => {
    for (const socket of sockets) socket.terminate();
    webSockets.close();
    server.close();
  });

  const result = await runStreamingCli({ apiUrl, mode: 'client', pathValue: recorder.pathValue });

  assert.deepEqual(result, { code: 0, signal: null, stderr: '' });
  assert.deepEqual(requests, [{ body: '{"expiresIn":60}', apiKey: 'test-key' }]);
});

test('duration bounds a WebSocket handshake that never opens', { timeout: 5_000 }, async (t) => {
  const heldSockets = new Set<import('node:stream').Duplex>();
  const server = createServer();
  server.on('upgrade', (_request, socket) => {
    heldSockets.add(socket);
  });
  const apiUrl = await listen(server);
  t.after(() => {
    for (const socket of heldSockets) socket.destroy();
    server.close();
  });

  const result = await runStreamingCli({ apiUrl, mode: 'server' });

  assert.deepEqual(result, { code: 0, signal: null, stderr: '' });
});

for (const [signal, expectedCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  test(`${signal} cancels pending client token acquisition`, async (t) => {
    let childProcess: ChildProcess | undefined;
    const server = createServer(() => {
      childProcess?.kill(signal);
    });
    const apiUrl = await listen(server);
    t.after(() => server.close());

    const result = await runStreamingCli({
      apiUrl,
      mode: 'client',
      onSpawn(child) {
        childProcess = child;
      },
    });

    assert.deepEqual(result, { code: expectedCode, signal: null, stderr: '' });
  });

  test(`${signal} cleans streaming resources and preserves semantic exit status`, async (t) => {
    const heldSockets = new Set<import('node:stream').Duplex>();
    const server = createServer();
    server.on('upgrade', (_request, socket) => {
      heldSockets.add(socket);
    });
    const apiUrl = await listen(server);
    t.after(() => {
      for (const socket of heldSockets) socket.destroy();
      server.close();
    });

    const result = await runStreamingCli({
      apiUrl,
      mode: 'server',
      onSpawn(child) {
        server.once('upgrade', () => child.kill(signal));
      },
    });

    assert.deepEqual(result, { code: expectedCode, signal: null, stderr: '' });
  });
}

test('microphone audio waits for the provider connected status', { timeout: 5_000 }, async (t) => {
  const recorder = await createFakeRecorder();
  t.after(() => rm(recorder.directory, { recursive: true, force: true }));
  const received: Array<{ beforeConnected: boolean; payload: unknown }> = [];
  const server = createServer();
  const webSockets = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  webSockets.on('connection', (socket) => {
    sockets.add(socket);
    let connected = false;
    socket.on('message', (data) => {
      received.push({ beforeConnected: !connected, payload: JSON.parse(data.toString()) });
    });
    setTimeout(() => {
      connected = true;
      socket.send(JSON.stringify({ type: 'status', status: 'connected' }));
    }, 700);
  });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request);
    });
  });
  const apiUrl = await listen(server);
  t.after(() => {
    for (const socket of sockets) socket.terminate();
    webSockets.close();
    server.close();
  });

  const result = await runStreamingCli({ apiUrl, mode: 'server', pathValue: recorder.pathValue });

  assert.deepEqual(result, { code: 0, signal: null, stderr: '' });
  assert(received.length > 0);
  assert.equal(received.some(({ beforeConnected }) => beforeConnected), false);
});
