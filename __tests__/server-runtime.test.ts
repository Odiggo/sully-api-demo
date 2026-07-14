import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';

import type { DemoLogEvent, DemoLogger } from '../server/demo-logger.js';
import { LOOPBACK_HOST, startServer } from '../server/server-runtime.js';
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

test('binds only loopback and does not open browser when disabled', async (t) => {
  let openCalls = 0;
  const harness = loggerHarness();
  const server = await startServer({
    app: express(),
    config: testConfig(false),
    openUrl: async () => {
      openCalls += 1;
    },
    logger: harness.logger,
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert(address && typeof address === 'object');
  assert.equal(address.address, LOOPBACK_HOST);
  assert.equal(openCalls, 0);
  assert.deepEqual(harness.events, [
    { event: 'server_listening', port: address.port },
  ]);
});

test('opens the actual ephemeral URL once after listener readiness', async (t) => {
  const opened: string[] = [];
  const harness = loggerHarness();
  const server = await startServer({
    app: express(),
    config: testConfig(true),
    openUrl: async (url) => {
      opened.push(url);
    },
    logger: harness.logger,
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert(address && typeof address === 'object');
  assert.deepEqual(opened, [`http://${LOOPBACK_HOST}:${address.port}/`]);
});

test('browser opener rejection warns safely without stopping listener', async (t) => {
  const harness = loggerHarness();
  const server = await startServer({
    app: express(),
    config: testConfig(true),
    openUrl: async () => {
      throw new Error('/private/path secret-key');
    },
    logger: harness.logger,
  });
  t.after(() => closeServer(server));
  assert.equal(server.listening, true);
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
      openUrl: async () => undefined,
      logger: harness.logger,
    }),
  );
});
