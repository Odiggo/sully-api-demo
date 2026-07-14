export const POLL_INTERVAL_MS = 2_000;
export const NOTE_AND_CODING_TIMEOUT_MS = 300_000;
export const TRANSCRIPTION_TIMEOUT_MS = 900_000;

export type PollClassification = 'pending' | 'complete' | 'failed';

export interface PollOptions<Value> {
  operation: (signal: AbortSignal) => Promise<Value>;
  classify: (value: Value) => PollClassification;
  intervalMs: number;
  deadlineMs: number;
  signal?: AbortSignal;
  now: () => number;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class PollTimeoutError extends Error {
  constructor() {
    super('Workflow polling timed out');
    this.name = 'PollTimeoutError';
  }
}

export class PollFailedError<Value> extends Error {
  constructor(readonly value: Value) {
    super('Workflow reached a failed state');
    this.name = 'PollFailedError';
  }
}

function abortError(): DOMException {
  return new DOMException('Operation aborted', 'AbortError');
}

export async function pollUntilComplete<Value>(options: PollOptions<Value>): Promise<Value> {
  if (options.signal?.aborted) throw abortError();
  const startedAt = options.now();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    while (true) {
      if (controller.signal.aborted) throw abortError();
      const value = await options.operation(controller.signal);
      if (controller.signal.aborted) throw abortError();
      const classification = options.classify(value);
      if (classification === 'complete') return value;
      if (classification === 'failed') throw new PollFailedError(value);
      const elapsed = options.now() - startedAt;
      if (elapsed >= options.deadlineMs) throw new PollTimeoutError();
      const wait = Math.min(options.intervalMs, options.deadlineMs - elapsed);
      await options.sleep(wait, controller.signal);
      if (options.now() - startedAt >= options.deadlineMs) throw new PollTimeoutError();
    }
  } finally {
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(abortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}
