import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SullyStreamingDemo,
  type AudioContextPort,
  type RecorderPort,
  type SocketPort,
  type StreamingDependencies,
  type StreamingTimers,
} from '../sully-browser-demo.js';
import { encodeStreamingAudio } from '../streaming-audio.js';
import { createStreamingCoordinator } from '../browser/workflows/streaming-workflow.js';

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

interface HarnessOptions {
  token?: ReturnType<typeof deferred<{ token: string; apiUrl: string; accountId: string }>>;
  recorder?: ReturnType<typeof deferred<void>>;
  failRelease?: 'recorder' | 'audio' | 'socket' | 'listener';
  connectSocket?: boolean;
  closeAfterConnect?: boolean;
  closeAfterConnectAttempt?: number;
  timers?: StreamingTimers;
}

function createTransportHarness(options: HarnessOptions = {}) {
  const counts = { token: 0, recorder: 0, recorderStop: 0, audio: 0, audioClose: 0, socket: 0, socketClose: 0, complete: 0 };
  const socketUrls: string[] = [];
  let tokenSignal: AbortSignal | undefined;
  let audioHandler: ((samples: Float32Array) => void) | undefined;
  let closeHandler: (() => void) | undefined;
  let recorderStarted = false;
  const recorder: RecorderPort = {
    get isRecording() {
      return recorderStarted && counts.recorderStop === 0;
    },
    async start() {
      counts.recorder += 1;
      await (options.recorder?.promise ?? Promise.resolve());
      recorderStarted = true;
    },
    stop() {
      counts.recorderStop += 1;
      if (options.failRelease === 'recorder') throw new Error('recorder release failed');
    },
    setAudioHandler(handler) {
      audioHandler = handler;
    },
  };
  const audioContext: AudioContextPort = {
    sampleRate: 16_000,
    native: {},
    async close() {
      counts.audioClose += 1;
      if (options.failRelease === 'audio') throw new Error('audio release failed');
    },
  };
  const socket: SocketPort = {
    readyState: 1,
    setMessageHandler(handler) {
      if (!handler && options.failRelease === 'listener') {
        throw new Error('listener release failed');
      }
      if (handler && options.connectSocket !== false) {
        queueMicrotask(() => {
          handler(JSON.stringify({ type: 'status', status: 'connected' }));
          if (
            options.closeAfterConnect ||
            options.closeAfterConnectAttempt === counts.socket
          ) closeHandler?.();
        });
      }
    },
    setCloseHandler(handler) {
      closeHandler = handler;
    },
    setErrorHandler() {},
    send() {},
    close() {
      counts.socketClose += 1;
      if (options.failRelease === 'socket') throw new Error('socket release failed');
    },
  };
  const timers: StreamingTimers = {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    setInterval: () => 2,
    clearInterval: () => undefined,
  };
  const dependencies: StreamingDependencies = {
    createRecorder: () => recorder,
    createAudioContext: () => {
      counts.audio += 1;
      return audioContext;
    },
    createSocket: (url) => {
      counts.socket += 1;
      socketUrls.push(url);
      return socket;
    },
    timers: options.timers ?? timers,
  };
  const errors: Error[] = [];
  const transport = new SullyStreamingDemo(
    {
      createStreamingToken: async (_expiresIn, signal) => {
        counts.token += 1;
        tokenSignal = signal;
        return options.token?.promise ?? {
          token: 'token',
          apiUrl: 'https://api.sully.ai/v1',
          accountId: 'account',
        };
      },
      onComplete: () => {
        counts.complete += 1;
      },
      onError: (error) => errors.push(error),
    },
    dependencies,
  );
  return {
    transport,
    dependencies,
    counts,
    socketUrls,
    errors,
    tokenSignal: () => tokenSignal,
    audioHandler: () => audioHandler,
    triggerSocketClose: () => closeHandler?.(),
  };
}

test('encodes documented little-endian linear16 audio', () => {
  const encoded = encodeStreamingAudio(new Float32Array([-1, 0, 1]));
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.byteLength, 6);
  assert.deepEqual(
    [bytes.readInt16LE(0), bytes.readInt16LE(2), bytes.readInt16LE(4)],
    [-32_768, 0, 32_767],
  );
});

test('opens streaming socket with documented linear16 encoding', async () => {
  const harness = createTransportHarness();
  await harness.transport.start();
  assert.match(harness.socketUrls[0] ?? '', /[?&]encoding=linear16(?:&|$)/);
  await harness.transport.stop('manual');
});

test('connected socket closing before start continuation never reaches live', async () => {
  const harness = createTransportHarness({ closeAfterConnect: true });
  await harness.transport.start();
  assert.equal(harness.transport.getPhase(), 'error');
  assert.equal(harness.counts.recorder, 0);
  assert.equal(harness.errors.length, 1);
});

test('socket closing while microphone permission is pending never reaches live', async () => {
  const recorder = deferred<void>();
  const harness = createTransportHarness({ recorder });
  const starting = harness.transport.start();
  while (harness.counts.recorder === 0) await Promise.resolve();
  harness.triggerSocketClose();
  recorder.resolve();
  await starting;
  assert.equal(harness.transport.getPhase(), 'error');
  assert.equal(harness.counts.recorderStop, 1);
  assert.equal(harness.errors.length, 1);
});

test('stop during token acquisition prevents recorder and socket creation', async () => {
  const token = deferred<{ token: string; apiUrl: string; accountId: string }>();
  const harness = createTransportHarness({ token });
  const starting = harness.transport.start();
  await Promise.resolve();
  const stopping = harness.transport.stop('pagehide');
  assert.equal(harness.tokenSignal()?.aborted, true);
  token.resolve({ token: 'late', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' });
  await Promise.allSettled([starting, stopping]);
  assert.equal(harness.counts.recorder, 0);
  assert.equal(harness.counts.socket, 0);
  assert.equal(harness.counts.complete, 1);
});

test('stop while recorder permission is pending releases late recorder without live phase', async () => {
  const recorder = deferred<void>();
  const harness = createTransportHarness({ recorder });
  const phases: string[] = [];
  const transport = new SullyStreamingDemo(
    {
      createStreamingToken: async () => ({ token: 'token', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' }),
      onPhaseChange: (phase) => phases.push(phase),
    },
    harness.dependencies,
  );
  const starting = transport.start();
  while (harness.counts.recorder === 0) await Promise.resolve();
  await transport.stop('pagehide');
  recorder.resolve();
  await starting;
  assert.equal(harness.counts.recorderStop, 1);
  assert(!phases.includes('live'));
});

test('concurrent start and repeated stop own one generation, then restart fresh', async () => {
  const harness = createTransportHarness();
  await Promise.all([harness.transport.start(), harness.transport.start()]);
  await Promise.all([harness.transport.stop('manual'), harness.transport.stop('manual')]);
  assert.deepEqual(
    { token: harness.counts.token, recorder: harness.counts.recorder, socket: harness.counts.socket, complete: harness.counts.complete },
    { token: 1, recorder: 1, socket: 1, complete: 1 },
  );
  await harness.transport.start();
  assert.equal(harness.counts.token, 2);
  assert.equal(harness.counts.recorder, 2);
  assert.equal(harness.counts.socket, 2);
});

test('auto-stop countdown decrements once per interval', async () => {
  const harness = createTransportHarness();
  let intervalCallback: (() => void) | undefined;
  const ticks: number[] = [];
  const transport = new SullyStreamingDemo(
    {
      duration: 3_000,
      createStreamingToken: async () => ({ token: 'token', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' }),
      onAutoStopTick: (remaining) => ticks.push(remaining),
    },
    {
      ...harness.dependencies,
      timers: {
        ...harness.dependencies.timers,
        setInterval(callback) {
          intervalCallback = callback;
          return 2;
        },
      },
    },
  );
  await transport.start();
  intervalCallback?.();
  intervalCallback?.();
  assert.deepEqual(ticks, [3, 2, 1]);
  await transport.stop('manual');
});

test('stop clears pending handshake timeout and suppresses late timeout error', async () => {
  const harness = createTransportHarness({ connectSocket: false });
  let timeoutCallback: (() => void) | undefined;
  let clearCalls = 0;
  const errors: Error[] = [];
  const transport = new SullyStreamingDemo(
    {
      createStreamingToken: async () => ({ token: 'token', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' }),
      onError: (error) => errors.push(error),
    },
    {
      ...harness.dependencies,
      timers: {
        ...harness.dependencies.timers,
        setTimeout(callback) {
          timeoutCallback = callback;
          return 1;
        },
        clearTimeout() {
          clearCalls += 1;
        },
      },
    },
  );
  const starting = transport.start();
  while (harness.counts.socket === 0) await Promise.resolve();
  await transport.stop('pagehide');
  await starting;
  timeoutCallback?.();
  assert.equal(clearCalls, 1);
  assert.deepEqual(errors, []);
});

test('unexpected live socket close reconnects with one fresh token', async () => {
  const harness = createTransportHarness();
  let retry: (() => void) | undefined;
  const attempts: number[] = [];
  const transport = new SullyStreamingDemo(
    {
      createStreamingToken: async () => {
        harness.counts.token += 1;
        return { token: 'token', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' };
      },
      onReconnectAttempt: ({ attempt }) => attempts.push(attempt),
    },
    {
      ...harness.dependencies,
      timers: {
        ...harness.dependencies.timers,
        setTimeout(callback, milliseconds) {
          if (milliseconds === 1_000) retry = callback;
          return milliseconds;
        },
      },
    },
  );
  await transport.start();
  harness.triggerSocketClose();
  assert.equal(transport.getPhase(), 'reconnecting');
  assert.deepEqual(attempts, [1]);
  retry?.();
  while (harness.counts.socket < 2) await Promise.resolve();
  for (let turn = 0; turn < 5 && transport.getPhase() !== 'live'; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(harness.counts.token, 2);
  assert.equal(harness.counts.socketClose, 1);
  assert.equal(transport.getPhase(), 'live');
  await transport.stop('manual');
});

test('immediate close during reconnect schedules exactly one next attempt', async () => {
  const retryCallbacks: Array<() => void> = [];
  const timers: StreamingTimers = {
    setTimeout(callback, milliseconds) {
      if (milliseconds < 10_000) retryCallbacks.push(callback);
      return callback;
    },
    clearTimeout: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const harness = createTransportHarness({ closeAfterConnectAttempt: 2, timers });
  await harness.transport.start();
  harness.triggerSocketClose();
  const firstRetry = retryCallbacks.shift();
  assert(firstRetry);
  firstRetry();
  while (harness.counts.socket < 2) await Promise.resolve();
  for (let turn = 0; turn < 20 && retryCallbacks.length === 0; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(retryCallbacks.length, 1);
  await harness.transport.stop('manual');
});

for (const failingStep of ['recorder', 'audio', 'socket', 'listener'] as const) {
  test(`cleanup continues when ${failingStep} release fails`, async () => {
    const harness = createTransportHarness({ failRelease: failingStep });
    await harness.transport.start();
    await harness.transport.stop('manual');
    assert.deepEqual(
      {
        recorder: harness.counts.recorderStop,
        audio: harness.counts.audioClose,
        socket: harness.counts.socketClose,
        complete: harness.counts.complete,
      },
      { recorder: 1, audio: 1, socket: 1, complete: 1 },
    );
    assert.equal(harness.errors.length, 1);
  });
}

test('navigation confirmation and deactivation await transport stop', async () => {
  const stop = deferred<void>();
  let stopCalls = 0;
  const coordinator = createStreamingCoordinator({
    transport: {
      getPhase: () => 'live',
      start: async () => undefined,
      stop: async () => {
        stopCalls += 1;
        await stop.promise;
      },
      setLanguage() {},
      setDictation() {},
      setTokenExpiresIn() {},
    },
    confirmStop: async () => true,
  });
  assert.equal(await coordinator.canDeactivate(), true);
  const deactivating = coordinator.deactivate();
  await Promise.resolve();
  assert.equal(stopCalls, 1);
  let settled = false;
  void deactivating.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  stop.resolve();
  await deactivating;
});
