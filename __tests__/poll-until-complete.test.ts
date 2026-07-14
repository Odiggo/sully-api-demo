import assert from 'node:assert/strict';
import test from 'node:test';

import { PollFailedError, PollTimeoutError, pollUntilComplete } from '../browser/poll-until-complete.js';

test('does not call operation when signal is pre-aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    pollUntilComplete({
      operation: async () => {
        calls += 1;
        return 'pending';
      },
      classify: () => 'pending',
      intervalMs: 2_000,
      deadlineMs: 10_000,
      signal: controller.signal,
      now: () => 0,
      sleep: async () => undefined,
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});

test('polls pending values and returns completed value', async () => {
  let now = 100;
  let calls = 0;
  const result = await pollUntilComplete({
    operation: async () => (++calls === 3 ? 'complete' : 'pending'),
    classify: (value) => (value === 'complete' ? 'complete' : 'pending'),
    intervalMs: 2_000,
    deadlineMs: 10_000,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
  });
  assert.equal(result, 'complete');
  assert.equal(calls, 3);
  assert.equal(now, 4_100);
});

test('stops at exact deadline without another operation', async () => {
  let now = 0;
  let calls = 0;
  await assert.rejects(
    pollUntilComplete({
      operation: async () => {
        calls += 1;
        return 'pending';
      },
      classify: () => 'pending',
      intervalMs: 2_000,
      deadlineMs: 10_000,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    }),
    PollTimeoutError,
  );
  assert.equal(now, 10_000);
  assert.equal(calls, 5);
});

test('surfaces failed terminal value without another poll', async () => {
  const failed = { status: 'failed' };
  await assert.rejects(
    pollUntilComplete({
      operation: async () => failed,
      classify: () => 'failed',
      intervalMs: 2_000,
      deadlineMs: 10_000,
      now: () => 0,
      sleep: async () => undefined,
    }),
    (error: unknown) => error instanceof PollFailedError && error.value === failed,
  );
});

test('caller abort reaches active operation and cleans listener', async () => {
  const caller = new AbortController();
  let operationSignal: AbortSignal | undefined;
  const result = pollUntilComplete({
    operation: async (signal) => {
      operationSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    },
    classify: () => 'pending',
    intervalMs: 2_000,
    deadlineMs: 10_000,
    signal: caller.signal,
    now: () => 0,
    sleep: async () => undefined,
  });
  caller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(operationSignal?.aborted, true);
});

test('caller abort wins even when operation ignores its signal and resolves late', async () => {
  const caller = new AbortController();
  let resolveOperation: ((value: string) => void) | undefined;
  const result = pollUntilComplete({
    operation: async () =>
      new Promise<string>((resolve) => {
        resolveOperation = resolve;
      }),
    classify: () => 'complete',
    intervalMs: 2_000,
    deadlineMs: 10_000,
    signal: caller.signal,
    now: () => 0,
    sleep: async () => undefined,
  });
  caller.abort();
  resolveOperation?.('late');
  await assert.rejects(result, { name: 'AbortError' });
});
