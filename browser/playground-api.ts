import { type ZodType } from 'zod';

import {
  MAX_AUDIO_FILE_BYTES,
  apiErrorSchema,
  codingIdSchema,
  codingRequestSchema,
  codingResponseSchema,
  healthResponseSchema,
  noteCreateResponseSchema,
  noteIdSchema,
  noteRequestSchema,
  noteResponseSchema,
  streamingTokenBrokerResponseSchema,
  streamingTokenRequestSchema,
  textToJsonRequestSchema,
  textToJsonResponseSchema,
  transcriptionIdSchema,
  transcriptionResponseSchema,
  type CodingRequest,
  type CodingResponse,
  type HealthResponse,
  type NoteCreateResponse,
  type NoteRequest,
  type NoteResponse,
  type StreamingTokenBrokerResponse,
  type TextToJsonRequest,
  type TextToJsonResponse,
  type TimerScheduler,
  type TranscriptionResponse,
} from '../contracts/index.js';

export const LOCAL_JSON_REQUEST_TIMEOUT_MS = 60_000;
export const LOCAL_UPLOAD_REQUEST_TIMEOUT_MS = 900_000;

export type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class PlaygroundApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PlaygroundApiError';
  }
}

export interface PlaygroundApi {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  createStreamingToken(
    expiresIn: number,
    signal?: AbortSignal,
  ): Promise<StreamingTokenBrokerResponse>;
  createTranscription(input: FormData, signal?: AbortSignal): Promise<TranscriptionResponse>;
  getTranscription(id: string, signal?: AbortSignal): Promise<TranscriptionResponse>;
  createNote(input: NoteRequest, signal?: AbortSignal): Promise<NoteCreateResponse>;
  getNote(id: string, signal?: AbortSignal): Promise<NoteResponse>;
  createCoding(input: CodingRequest, signal?: AbortSignal): Promise<CodingResponse>;
  getCoding(id: string, signal?: AbortSignal): Promise<CodingResponse>;
  textToJson(input: TextToJsonRequest, signal?: AbortSignal): Promise<TextToJsonResponse>;
  loadSampleAudio(signal?: AbortSignal): Promise<File>;
}

export interface CreatePlaygroundApiOptions {
  fetch: BrowserFetch;
  timers?: TimerScheduler;
}

const defaultTimers: TimerScheduler = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseSuccess<Output>(schema: ZodType<Output>, text: string): Output {
  const result = schema.safeParse(parseJson(text));
  if (!result.success) {
    throw new PlaygroundApiError(
      'LOCAL_API_INVALID_RESPONSE',
      'Local API returned an invalid response',
    );
  }
  return result.data;
}

function parseHttpError(text: string): PlaygroundApiError {
  const parsed = apiErrorSchema.safeParse(parseJson(text));
  return parsed.success
    ? new PlaygroundApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      )
    : new PlaygroundApiError('LOCAL_API_HTTP_ERROR', 'Local API request failed');
}

interface ExecuteInput<Output> {
  path: string;
  init?: RequestInit;
  timeoutMs?: number;
  signal?: AbortSignal;
  parse: (response: Response) => Promise<Output>;
}

type Execute = <Output>(input: ExecuteInput<Output>) => Promise<Output>;
type JsonRequest = <Output>(
  path: string,
  schema: ZodType<Output>,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs?: number,
) => Promise<Output>;
type JsonPost = <Output>(
  path: string,
  body: unknown,
  schema: ZodType<Output>,
  signal?: AbortSignal,
) => Promise<Output>;

function createExecute(options: CreatePlaygroundApiOptions): Execute {
  const timers = options.timers ?? defaultTimers;
  return async function execute<Output>(input: ExecuteInput<Output>): Promise<Output> {
    if (input.signal?.aborted) {
      throw new PlaygroundApiError('LOCAL_API_ABORTED', 'Request was cancelled');
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutHandle = timers.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs ?? LOCAL_JSON_REQUEST_TIMEOUT_MS);
    try {
      const response = await options.fetch(input.path, {
        ...input.init,
        signal: controller.signal,
      });
      if (!response.ok) throw parseHttpError(await response.text());
      return await input.parse(response);
    } catch (error: unknown) {
      if (error instanceof PlaygroundApiError) throw error;
      if (timedOut) {
        throw new PlaygroundApiError('LOCAL_API_TIMEOUT', 'Local API request timed out');
      }
      if (input.signal?.aborted) {
        throw new PlaygroundApiError('LOCAL_API_ABORTED', 'Request was cancelled');
      }
      throw new PlaygroundApiError('LOCAL_API_TRANSPORT_ERROR', 'Unable to reach local API');
    } finally {
      timers.clearTimeout(timeoutHandle);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  };
}

function createJsonRequest(execute: Execute): JsonRequest {
  return (path, schema, init, signal, timeoutMs) =>
    execute({
      path,
      init,
      signal,
      timeoutMs,
      parse: async (response) => parseSuccess(schema, await response.text()),
    });
}

function createJsonPost(json: JsonRequest): JsonPost {
  return (path, body, schema, signal) =>
    json(
      path,
      schema,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      signal,
    );
}

async function parseSampleAudio(response: Response): Promise<File> {
  const blob = await response.blob();
  if (blob.type !== 'audio/wav' || blob.size < 1 || blob.size > MAX_AUDIO_FILE_BYTES) {
    throw new PlaygroundApiError('LOCAL_SAMPLE_INVALID', 'Bundled sample audio is invalid');
  }
  return new File([blob], 'demo-audio.wav', { type: 'audio/wav' });
}

function createApiMethods(execute: Execute, json: JsonRequest, post: JsonPost): PlaygroundApi {
  return {
    getHealth: (signal) => json('/health', healthResponseSchema, undefined, signal),
    createStreamingToken: (expiresIn, signal) =>
      post(
        '/api/streaming-token',
        streamingTokenRequestSchema.parse({ expiresIn }),
        streamingTokenBrokerResponseSchema,
        signal,
      ),
    createTranscription: (formData, signal) =>
      json(
        '/api/transcriptions',
        transcriptionResponseSchema,
        { method: 'POST', body: formData },
        signal,
        LOCAL_UPLOAD_REQUEST_TIMEOUT_MS,
      ),
    getTranscription: (id, signal) =>
      json(
        `/api/transcriptions/${encodeURIComponent(transcriptionIdSchema.parse(id))}`,
        transcriptionResponseSchema,
        undefined,
        signal,
      ),
    createNote: (input, signal) =>
      post('/api/notes', noteRequestSchema.parse(input), noteCreateResponseSchema, signal),
    getNote: (id, signal) =>
      json(
        `/api/notes/${encodeURIComponent(noteIdSchema.parse(id))}`,
        noteResponseSchema,
        undefined,
        signal,
      ),
    createCoding: (input, signal) =>
      post('/api/codings', codingRequestSchema.parse(input), codingResponseSchema, signal),
    getCoding: (id, signal) =>
      json(
        `/api/codings/${encodeURIComponent(codingIdSchema.parse(id))}`,
        codingResponseSchema,
        undefined,
        signal,
      ),
    textToJson: (input, signal) =>
      post(
        '/api/text-to-json',
        textToJsonRequestSchema.parse(input),
        textToJsonResponseSchema,
        signal,
      ),
    loadSampleAudio: (signal) =>
      execute({
        path: '/samples/demo-audio.wav',
        signal,
        parse: parseSampleAudio,
      }),
  };
}

export function createPlaygroundApi(options: CreatePlaygroundApiOptions): PlaygroundApi {
  const execute = createExecute(options);
  const json = createJsonRequest(execute);
  return createApiMethods(execute, json, createJsonPost(json));
}
