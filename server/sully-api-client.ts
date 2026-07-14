import { createReadStream, type ReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import FormData from 'form-data';
import nodeFetch, { type RequestInit, type Response } from 'node-fetch';
import { type ZodType } from 'zod';

import {
  type CodingRequest,
  type CodingResponse,
  type NoteCreateResponse,
  type NoteRequest,
  type NoteResponse,
  type StreamingTokenRequest,
  type TextToJsonRequest,
  type TextToJsonResponse,
  type TimerScheduler,
  type TranscriptionResponse,
  type UpstreamStreamingToken,
  codingIdSchema,
  codingResponseSchema,
  noteCreateResponseSchema,
  noteIdSchema,
  noteResponseSchema,
  parseApprovedSullyOrigin,
  streamingTokenRequestSchema,
  textToJsonResponseSchema,
  transcriptionIdSchema,
  transcriptionResponseSchema,
  upstreamStreamingTokenSchema,
} from '../contracts/index.js';

export const UPSTREAM_JSON_REQUEST_TIMEOUT_MS = 60_000;
export const UPSTREAM_UPLOAD_REQUEST_TIMEOUT_MS = 900_000;
export const MAX_UPSTREAM_RESPONSE_BYTES = 1_048_576;

export const SULLY_UPSTREAM_ROUTES = Object.freeze({
  transcriptions: '/v2/audio/transcriptions',
  transcription: (id: string) => `/v2/audio/transcriptions/${encodeURIComponent(id)}`,
  notes: '/v1/notes',
  note: (id: string) => `/v1/notes/${encodeURIComponent(id)}`,
  codings: '/v1/codings',
  coding: (id: string) => `/v1/codings/${encodeURIComponent(id)}`,
  textToJson: '/v1/utils/text-to-json',
  streamingToken: '/v1/audio/transcriptions/stream/token',
});

export type NodeFetch = typeof nodeFetch;
export type ReadStreamFactory = (filePath: string) => ReadStream;

export interface SullyRequestContext {
  requestId: string;
  signal?: AbortSignal;
}

export interface TranscriptionUpload {
  filePath: string;
  upstreamFilename: string;
  contentType: string;
  language: string;
  dictation: boolean;
  multichannel: boolean;
}

export interface SullyApiClient {
  createTranscription(
    input: TranscriptionUpload,
    context: SullyRequestContext,
  ): Promise<TranscriptionResponse>;
  getTranscription(id: string, context: SullyRequestContext): Promise<TranscriptionResponse>;
  createNote(input: NoteRequest, context: SullyRequestContext): Promise<NoteCreateResponse>;
  getNote(id: string, context: SullyRequestContext): Promise<NoteResponse>;
  createCoding(input: CodingRequest, context: SullyRequestContext): Promise<CodingResponse>;
  getCoding(id: string, context: SullyRequestContext): Promise<CodingResponse>;
  textToJson(input: TextToJsonRequest, context: SullyRequestContext): Promise<TextToJsonResponse>;
  createStreamingToken(
    expiresIn: StreamingTokenRequest['expiresIn'],
    context: SullyRequestContext,
  ): Promise<UpstreamStreamingToken>;
}

export type SullyApiErrorCode =
  | 'UPSTREAM_ABORTED'
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'UPSTREAM_RESPONSE_TOO_LARGE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_TRANSPORT_ERROR';

export class SullyApiError extends Error {
  constructor(
    readonly code: SullyApiErrorCode,
    readonly requestId: string,
    readonly upstreamStatus?: number,
  ) {
    super(messageForCode(code));
    this.name = 'SullyApiError';
  }
}

interface SullyApiClientOptions {
  apiUrl: URL;
  apiKey: string;
  accountId: string;
  fetch?: NodeFetch;
  timers?: TimerScheduler;
  createFileStream?: ReadStreamFactory;
}

interface RequestOptions<Output> {
  path: string;
  method: 'GET' | 'POST';
  schema: ZodType<Output>;
  context: SullyRequestContext;
  body?: RequestInit['body'];
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const defaultTimers: TimerScheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function messageForCode(code: SullyApiErrorCode): string {
  const messages: Record<SullyApiErrorCode, string> = {
    UPSTREAM_ABORTED: 'Sully request was cancelled',
    UPSTREAM_HTTP_ERROR: 'Sully API rejected the request',
    UPSTREAM_INVALID_RESPONSE: 'Sully API returned an invalid response',
    UPSTREAM_RESPONSE_TOO_LARGE: 'Sully API response exceeded the local safety limit',
    UPSTREAM_TIMEOUT: 'Sully request exceeded the local timeout',
    UPSTREAM_TRANSPORT_ERROR: 'Unable to reach the Sully API',
  };
  return messages[code];
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return '';
  const decoder = new StringDecoder('utf8');
  let bytesRead = 0;
  let text = '';
  for await (const value of response.body) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytesRead += chunk.byteLength;
    if (bytesRead > MAX_UPSTREAM_RESPONSE_BYTES) {
      if (response.body instanceof Readable) response.body.destroy();
      throw new SullyApiError('UPSTREAM_RESPONSE_TOO_LARGE', 'unassigned');
    }
    text += decoder.write(chunk);
  }
  return text + decoder.end();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stopFileStream(stream: ReadStream): void {
  if (!stream.destroyed) stream.destroy();
}

type RequestOwner = <Output>(requestOptions: RequestOptions<Output>) => Promise<Output>;

function normalizeRequestError(
  error: unknown,
  context: SullyRequestContext,
  timedOut: boolean,
): SullyApiError {
  if (error instanceof SullyApiError) {
    return error.code === 'UPSTREAM_RESPONSE_TOO_LARGE'
      ? new SullyApiError(error.code, context.requestId)
      : error;
  }
  if (timedOut) return new SullyApiError('UPSTREAM_TIMEOUT', context.requestId);
  if (context.signal?.aborted) return new SullyApiError('UPSTREAM_ABORTED', context.requestId);
  return new SullyApiError('UPSTREAM_TRANSPORT_ERROR', context.requestId);
}

function createRequestOwner(options: SullyApiClientOptions): RequestOwner {
  const fetchImpl = options.fetch ?? nodeFetch;
  const timers = options.timers ?? defaultTimers;
  return async function request<Output>(requestOptions: RequestOptions<Output>): Promise<Output> {
    const { context } = requestOptions;
    if (context.signal?.aborted) {
      throw new SullyApiError('UPSTREAM_ABORTED', context.requestId);
    }

    const controller = new AbortController();
    let timedOut = false;
    const assertActive = () => {
      if (!controller.signal.aborted) return;
      throw new SullyApiError(
        timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ABORTED',
        context.requestId,
      );
    };
    const abortFromCaller = () => controller.abort();
    context.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutHandle = timers.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestOptions.timeoutMs ?? UPSTREAM_JSON_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(new URL(requestOptions.path, options.apiUrl), {
        method: requestOptions.method,
        headers: {
          'X-Api-Key': options.apiKey,
          'X-Account-Id': options.accountId,
          ...requestOptions.headers,
        },
        body: requestOptions.body,
        redirect: 'error',
        signal: controller.signal,
      });
      assertActive();
      const responseText = await readBoundedResponse(response);
      assertActive();
      if (!response.ok) {
        throw new SullyApiError(
          'UPSTREAM_HTTP_ERROR',
          context.requestId,
          response.status,
        );
      }
      const parsedJson = safeJsonParse(responseText);
      const parsed = requestOptions.schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new SullyApiError('UPSTREAM_INVALID_RESPONSE', context.requestId);
      }
      return parsed.data;
    } catch (error: unknown) {
      throw normalizeRequestError(error, context, timedOut);
    } finally {
      timers.clearTimeout(timeoutHandle);
      context.signal?.removeEventListener('abort', abortFromCaller);
    }
  };
}

function createTranscriptionMethod(
  request: RequestOwner,
  createFileStream: ReadStreamFactory,
): SullyApiClient['createTranscription'] {
  return async function createTranscription(
    input: TranscriptionUpload,
    context: SullyRequestContext,
  ): Promise<TranscriptionResponse> {
    const form = new FormData();
    const fileStream = createFileStream(input.filePath);
    form.append('audio', fileStream, {
      filename: input.upstreamFilename,
      contentType: input.contentType,
    });
    form.append('language', input.language);
    form.append('dictation', String(input.dictation));
    form.append('multichannel', String(input.multichannel));
    try {
      return await request({
        path: SULLY_UPSTREAM_ROUTES.transcriptions,
        method: 'POST',
        schema: transcriptionResponseSchema,
        context,
        body: form,
        headers: form.getHeaders(),
        timeoutMs: UPSTREAM_UPLOAD_REQUEST_TIMEOUT_MS,
      });
    } finally {
      stopFileStream(fileStream);
    }
  };
}

function createRestMethods(request: RequestOwner): Omit<SullyApiClient, 'createTranscription'> {
  return {
    getTranscription: (id, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.transcription(transcriptionIdSchema.parse(id)),
        method: 'GET',
        schema: transcriptionResponseSchema,
        context,
      }),
    createNote: (input, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.notes,
        method: 'POST',
        schema: noteCreateResponseSchema,
        context,
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    getNote: (id, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.note(noteIdSchema.parse(id)),
        method: 'GET',
        schema: noteResponseSchema,
        context,
      }),
    createCoding: (input, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.codings,
        method: 'POST',
        schema: codingResponseSchema,
        context,
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    getCoding: (id, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.coding(codingIdSchema.parse(id)),
        method: 'GET',
        schema: codingResponseSchema,
        context,
      }),
    textToJson: (input, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.textToJson,
        method: 'POST',
        schema: textToJsonResponseSchema,
        context,
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    createStreamingToken: (expiresIn, context) =>
      request({
        path: SULLY_UPSTREAM_ROUTES.streamingToken,
        method: 'POST',
        schema: upstreamStreamingTokenSchema,
        context,
        body: JSON.stringify(streamingTokenRequestSchema.parse({ expiresIn })),
        headers: { 'Content-Type': 'application/json' },
      }),
  };
}

export function createSullyApiClient(options: SullyApiClientOptions): SullyApiClient {
  const apiUrl = parseApprovedSullyOrigin(options.apiUrl);
  if (!apiUrl) throw new Error('Sully API URL must be an approved origin');
  const request = createRequestOwner({ ...options, apiUrl });
  return {
    createTranscription: createTranscriptionMethod(
      request,
      options.createFileStream ?? createReadStream,
    ),
    ...createRestMethods(request),
  };
}
