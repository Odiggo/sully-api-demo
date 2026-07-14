import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import express from 'express';

import type { DemoLogEvent, DemoLogger } from '../server/demo-logger.js';
import {
  LOOPBACK_HOST,
  SHUTDOWN_GRACE_MS,
  createProcessUploadDirectory,
  registerGracefulShutdown,
  startManagedServer,
  startServer,
} from '../server/server-runtime.js';
import type { ServerConfig } from '../server/server-config.js';

function testConfig(openBrowser: boolean): ServerConfig {
  return {
    port: 0,
    openBrowser,
    credentials: { ready: false, missing: ['SULLY_API_KEY'], invalid: [] },
  };
}

async function closeServer(server: ReturnType<typeof express.application.listen>): Promise<void> {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}

function loggerHarness(): { logger: DemoLogger; events: DemoLogEvent[] } {
  const events: DemoLogEvent[] = [];
  return {
    events,
    logger: {
      info: (event) => events.push(event),
      warn: (event) => events.push(event),
      error: (event) => events.push(event),
    },
  };
}

test('binds only loopback', async (t) => {
  const harness = loggerHarness();
  const server = await startServer({
    app: express(),
    config: testConfig(false),
    logger: harness.logger,
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert(address && typeof address === 'object');
  assert.equal(address.address, LOOPBACK_HOST);
  assert.deepEqual(harness.events, [
    { event: 'server_listening', port: address.port },
  ]);
});

test('managed startup registers shutdown before opening the actual URL', async (t) => {
  const order: string[] = [];
  const listeners = new Map<NodeJS.Signals, () => void>();
  const harness = loggerHarness();
  const runtime = await startManagedServer({
    app: express(),
    config: testConfig(true),
    openUrl: async (url) => {
      assert(listeners.has('SIGINT'));
      assert(listeners.has('SIGTERM'));
      order.push(url);
    },
    logger: harness.logger,
    signalSource: {
      once: (signal, listener) => listeners.set(signal, listener),
      off: (signal, listener) => {
        if (listeners.get(signal) === listener) listeners.delete(signal);
      },
    },
    cleanup: async () => undefined,
    setExitCode: () => undefined,
  });
  runtime.shutdown.dispose();
  t.after(() => closeServer(runtime.server));
  const address = runtime.server.address();
  assert(address && typeof address === 'object');
  assert.deepEqual(order, [`http://${LOOPBACK_HOST}:${address.port}/`]);
});

test('browser opener rejection warns safely without stopping listener', async (t) => {
  const harness = loggerHarness();
  const runtime = await startManagedServer({
    app: express(),
    config: testConfig(true),
    openUrl: async () => {
      throw new Error('/private/path secret-key');
    },
    logger: harness.logger,
    signalSource: { once: () => undefined, off: () => undefined },
    cleanup: async () => undefined,
    setExitCode: () => undefined,
  });
  runtime.shutdown.dispose();
  t.after(() => closeServer(runtime.server));
  assert.equal(runtime.server.listening, true);
  const serialized = JSON.stringify(harness.events);
  assert.match(serialized, /browser_open_failed/);
  assert(!serialized.includes('/private/path'));
  assert(!serialized.includes('secret-key'));
});

test('binding failure rejects startup', async (t) => {
  const blocker = express().listen(0, LOOPBACK_HOST);
  await once(blocker, 'listening');
  t.after(() => closeServer(blocker));
  const address = blocker.address();
  assert(address && typeof address === 'object');
  const harness = loggerHarness();
  await assert.rejects(
    startServer({
      app: express(),
      config: { ...testConfig(false), port: address.port },
      logger: harness.logger,
    }),
  );
});

test('termination signal drains server before cleaning uploads exactly once', async () => {
  const harness = loggerHarness();
  const listeners = new Map<NodeJS.Signals, () => void>();
  const order: string[] = [];
  let finishClose: ((error?: Error) => void) | undefined;
  const registration = registerGracefulShutdown({
    server: {
      close(callback) {
        order.push('close');
        finishClose = callback;
      },
      closeAllConnections() {
        order.push('force');
      },
    },
    signalSource: {
      once: (signal, listener) => listeners.set(signal, listener),
      off: (signal, listener) => {
        if (listeners.get(signal) === listener) listeners.delete(signal);
      },
    },
    cleanup: async () => {
      order.push('cleanup');
    },
    logger: harness.logger,
    setExitCode: (code) => order.push(`exit:${code}`),
    timers: {
      setTimeout(callback, milliseconds) {
        assert.equal(milliseconds, SHUTDOWN_GRACE_MS);
        return callback;
      },
      clearTimeout() {
        order.push('clear-timeout');
      },
    },
  });

  const terminate = listeners.get('SIGTERM');
  assert(terminate);
  terminate();
  terminate();
  assert.deepEqual(order, ['close']);
  assert.equal(listeners.size, 0);
  finishClose?.();
  await registration.completion;
  assert.deepEqual(order, ['close', 'clear-timeout', 'cleanup']);
  assert(JSON.stringify(harness.events).includes('server_stopped'));
});

test('shutdown failure is safe and sets a failing exit code', async () => {
  const harness = loggerHarness();
  let terminate: (() => void) | undefined;
  const exitCodes: number[] = [];
  const registration = registerGracefulShutdown({
    server: { close: (callback) => callback(), closeAllConnections: () => undefined },
    signalSource: {
      once: (_signal, listener) => {
        terminate = listener;
      },
      off: () => undefined,
    },
    cleanup: async () => {
      throw new Error('/private/upload/path');
    },
    logger: harness.logger,
    setExitCode: (code) => exitCodes.push(code),
  });

  terminate?.();
  await registration.completion;
  assert.deepEqual(exitCodes, [1]);
  const serialized = JSON.stringify(harness.events);
  assert(serialized.includes('shutdown_failed'));
  assert(!serialized.includes('/private/upload/path'));
});

test('server-close failure still cleans uploads before failing shutdown', async () => {
  const harness = loggerHarness();
  let terminate: (() => void) | undefined;
  let cleanupCalls = 0;
  const exitCodes: number[] = [];
  const registration = registerGracefulShutdown({
    server: {
      close: (callback) => callback(new Error('close failed')),
      closeAllConnections: () => undefined,
    },
    signalSource: {
      once: (_signal, listener) => {
        terminate = listener;
      },
      off: () => undefined,
    },
    cleanup: async () => {
      cleanupCalls += 1;
    },
    logger: harness.logger,
    setExitCode: (code) => exitCodes.push(code),
  });

  terminate?.();
  await registration.completion;
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(exitCodes, [1]);
  assert(JSON.stringify(harness.events).includes('shutdown_failed'));
});

test('shutdown forces active connections at the exact grace deadline', async () => {
  const order: string[] = [];
  let terminate: (() => void) | undefined;
  let deadline: (() => void) | undefined;
  const registration = registerGracefulShutdown({
    server: {
      close: () => order.push('close'),
      closeAllConnections: () => order.push('force'),
    },
    signalSource: {
      once: (_signal, listener) => {
        terminate = listener;
      },
      off: () => undefined,
    },
    cleanup: async () => {
      order.push('cleanup');
    },
    logger: loggerHarness().logger,
    setExitCode: () => undefined,
    timers: {
      setTimeout(callback, milliseconds) {
        assert.equal(milliseconds, SHUTDOWN_GRACE_MS);
        deadline = callback;
        return 1;
      },
      clearTimeout: () => order.push('clear-timeout'),
    },
  });

  terminate?.();
  await Promise.resolve();
  assert.deepEqual(order, ['close']);
  deadline?.();
  await registration.completion;
  assert.deepEqual(order, ['close', 'force', 'cleanup']);
});

test('each server process owns a distinct upload directory', async (t) => {
  const first = await createProcessUploadDirectory();
  const second = await createProcessUploadDirectory();
  t.after(async () => {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
    ]);
  });

  assert.notEqual(first, second);
  assert.match(first, /sully-api-demo-uploads-/);
  assert.match(second, /sully-api-demo-uploads-/);
});
