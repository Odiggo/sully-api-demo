import { unlink } from 'node:fs/promises';
import path from 'node:path';

import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { z } from 'zod';

import {
  MAX_AUDIO_FILE_BYTES,
  codingIdSchema,
  codingRequestSchema,
  multipartBooleanSchema,
  noteIdSchema,
  noteRequestSchema,
  streamingTokenBrokerResponseSchema,
  streamingTokenRequestSchema,
  textToJsonRequestSchema,
  transcriptionIdSchema,
  transcriptionLanguageSchema,
} from '../contracts/index.js';
import type { DemoLogger } from './demo-logger.js';
import { SullyApiError, type SullyApiClient, type SullyRequestContext } from './sully-api-client.js';

export const MAX_MULTIPART_FIELDS = 3;
export const MAX_MULTIPART_PARTS = 4;
export const MAX_MULTIPART_FIELD_BYTES = 1_024;

const uploadFieldsSchema = z.strictObject({
  language: transcriptionLanguageSchema,
  dictation: multipartBooleanSchema,
  multichannel: multipartBooleanSchema,
});

const AUDIO_TYPES = [
  { extension: '.wav', mimeTypes: ['audio/wav', 'audio/x-wav'] },
  { extension: '.mp3', mimeTypes: ['audio/mpeg'] },
  { extension: '.flac', mimeTypes: ['audio/flac', 'audio/x-flac'] },
  { extension: '.ogg', mimeTypes: ['audio/ogg'] },
  { extension: '.webm', mimeTypes: ['audio/webm'] },
  { extension: '.mp4', mimeTypes: ['audio/mp4', 'video/mp4'] },
  { extension: '.m4a', mimeTypes: ['audio/mp4', 'audio/x-m4a'] },
  { extension: '.aac', mimeTypes: ['audio/aac'] },
  { extension: '.opus', mimeTypes: ['audio/opus', 'audio/ogg'] },
] as const;

interface AudioType {
  extension: string;
  mimeType: string;
}

export interface CreateApiRouterOptions {
  client: SullyApiClient;
  uploadDirectory: string;
  logger: DemoLogger;
  streamingApiUrl: string;
  streamingAccountId: string;
  createUploadFilename: () => string;
  removeUploadFile?: (filePath: string) => Promise<void>;
}

class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'LocalApiError';
  }
}

function getRequestId(response: Response): string {
  const value = response.locals.requestId;
  return typeof value === 'string' ? value : 'unavailable';
}

function createContext(request: Request, response: Response): {
  context: SullyRequestContext;
  release: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortIfDisconnected = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once('aborted', abort);
  response.once('close', abortIfDisconnected);
  return {
    context: { requestId: getRequestId(response), signal: controller.signal },
    release: () => {
      request.off('aborted', abort);
      response.off('close', abortIfDisconnected);
    },
  };
}

function parseOrThrow<Output>(schema: z.ZodType<Output>, value: unknown): Output {
  const result = schema.safeParse(value);
  if (!result.success) throw new LocalApiError(400, 'INVALID_REQUEST', 'Request is invalid');
  return result.data;
}

function resolveAudioType(file: Express.Multer.File): AudioType | undefined {
  const extension = path.extname(file.originalname).toLowerCase();
  const matched = AUDIO_TYPES.find(
    (candidate) =>
      candidate.extension === extension &&
      candidate.mimeTypes.some((mimeType) => mimeType === file.mimetype.toLowerCase()),
  );
  return matched ? { extension: matched.extension, mimeType: file.mimetype.toLowerCase() } : undefined;
}

function toLocalError(error: unknown): LocalApiError {
  if (error instanceof LocalApiError) return error;
  if (error instanceof Error && 'status' in error && error.status === 413) {
    return new LocalApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    return new LocalApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (error instanceof SullyApiError) {
    const status = error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502;
    return new LocalApiError(status, error.code, error.message);
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new LocalApiError(status, 'INVALID_UPLOAD', 'Audio upload is invalid');
  }
  return new LocalApiError(500, 'INTERNAL_ERROR', 'Request could not be completed');
}

function sendError(response: Response, error: unknown): void {
  const localError = toLocalError(error);
  response.status(localError.status).json({
    error: {
      code: localError.code,
      message: localError.safeMessage,
      requestId: getRequestId(response),
    },
  });
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    handler(request, response).catch(next);
  };
}

async function removeUpload(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

async function withUploadCleanup<Output>(
  filePath: string,
  cleanup: (filePath: string) => Promise<void>,
  operation: () => Promise<Output>,
  onCleanupFailure: () => void,
): Promise<Output> {
  let result: { ok: true; value: Output } | { ok: false; error: unknown };
  try {
    result = { ok: true, value: await operation() };
  } catch (error: unknown) {
    result = { ok: false, error };
  }
  try {
    await cleanup(filePath);
  } catch {
    try {
      onCleanupFailure();
    } catch {
      // Cleanup telemetry cannot replace the provider outcome.
    }
  }
  if (!result.ok) throw result.error;
  return result.value;
}

function createUploadMiddleware(options: CreateApiRouterOptions): RequestHandler {
  const storage = multer.diskStorage({
    destination: options.uploadDirectory,
    filename: (request, _file, callback) => {
      const value = request.res?.locals.uploadFilename;
      callback(null, typeof value === 'string' ? value : options.createUploadFilename());
    },
  });
  const upload = multer({
    storage,
    limits: {
      // Busboy signals at equality; one sentinel byte lets route validation
      // distinguish the documented inclusive maximum from maximum + 1.
      fileSize: MAX_AUDIO_FILE_BYTES + 1,
      files: 1,
      fields: MAX_MULTIPART_FIELDS,
      // Busboy raises its sentinel at equality, so +1 accepts exactly four parts
      // while still rejecting a fifth before it is processed.
      parts: MAX_MULTIPART_PARTS + 1,
      fieldSize: MAX_MULTIPART_FIELD_BYTES,
    },
    fileFilter: (_request, file, callback) => {
      if (!resolveAudioType(file)) {
        return callback(new LocalApiError(400, 'INVALID_UPLOAD', 'Audio type is not supported'));
      }
      callback(null, true);
    },
  });
  return upload.single('audio');
}

async function processUploadedTranscription(
  options: CreateApiRouterOptions,
  request: Request,
  response: Response,
  uploadError: unknown,
): ReturnType<SullyApiClient['createTranscription']> {
  if (uploadError) throw uploadError;
  if (!request.file || request.file.size < 1) {
    throw new LocalApiError(400, 'INVALID_UPLOAD', 'One non-empty audio file is required');
  }
  if (request.file.size > MAX_AUDIO_FILE_BYTES) {
    throw new LocalApiError(413, 'UPLOAD_TOO_LARGE', 'Audio file exceeds 100 MB');
  }
  const audioType = resolveAudioType(request.file);
  if (!audioType) {
    throw new LocalApiError(400, 'INVALID_UPLOAD', 'Audio type is not supported');
  }
  const fields = parseOrThrow(uploadFieldsSchema, request.body);
  const owner = createContext(request, response);
  try {
    return await options.client.createTranscription(
      {
        filePath: request.file.path,
        upstreamFilename: `audio${audioType.extension}`,
        contentType: audioType.mimeType,
        language: fields.language,
        dictation: fields.dictation,
        multichannel: fields.multichannel,
      },
      owner.context,
    );
  } finally {
    owner.release();
  }
}

function registerUploadRoute(
  router: express.Router,
  options: CreateApiRouterOptions,
): void {
  const upload = createUploadMiddleware(options);
  router.post('/transcriptions', (request, response, next) => {
    response.locals.uploadFilename = options.createUploadFilename();
    const expectedPath = path.join(options.uploadDirectory, response.locals.uploadFilename);
    upload(request, response, (uploadError) => {
      withUploadCleanup(
        expectedPath,
        options.removeUploadFile ?? removeUpload,
        () => processUploadedTranscription(options, request, response, uploadError),
        () => options.logger.error({
          event: 'upload_cleanup_failed',
          requestId: getRequestId(response),
        }),
      )
        .then((result) => response.json(result))
        .catch(next);
    });
  });
}

function registerJsonPost<Input, Output>(
  router: express.Router,
  route: string,
  schema: z.ZodType<Input>,
  operation: (input: Input, context: SullyRequestContext) => Promise<Output>,
): void {
  router.post(
    route,
    asyncRoute(async (request, response) => {
      const input = parseOrThrow(schema, request.body);
      const owner = createContext(request, response);
      try {
        response.json(await operation(input, owner.context));
      } finally {
        owner.release();
      }
    }),
  );
}

function registerIdGet<Output>(
  router: express.Router,
  route: string,
  schema: z.ZodType<string>,
  operation: (id: string, context: SullyRequestContext) => Promise<Output>,
): void {
  router.get(
    route,
    asyncRoute(async (request, response) => {
      const id = parseOrThrow(schema, request.params.id);
      const owner = createContext(request, response);
      try {
        response.json(await operation(id, owner.context));
      } finally {
        owner.release();
      }
    }),
  );
}

function registerWorkflowRoutes(router: express.Router, client: SullyApiClient): void {
  registerIdGet(router, '/transcriptions/:id', transcriptionIdSchema, client.getTranscription.bind(client));
  registerJsonPost(router, '/notes', noteRequestSchema, client.createNote.bind(client));
  registerIdGet(router, '/notes/:id', noteIdSchema, client.getNote.bind(client));
  registerJsonPost(router, '/codings', codingRequestSchema, client.createCoding.bind(client));
  registerIdGet(router, '/codings/:id', codingIdSchema, client.getCoding.bind(client));
  registerJsonPost(router, '/text-to-json', textToJsonRequestSchema, client.textToJson.bind(client));
}

function registerStreamingRoute(
  router: express.Router,
  options: CreateApiRouterOptions,
): void {
  router.post(
    '/streaming-token',
    asyncRoute(async (request, response) => {
      const input = parseOrThrow(streamingTokenRequestSchema, request.body);
      const owner = createContext(request, response);
      try {
        const upstream = await options.client.createStreamingToken(input.expiresIn, owner.context);
        response.json(
          streamingTokenBrokerResponseSchema.parse({
            token: upstream.token,
            apiUrl: options.streamingApiUrl,
            accountId: options.streamingAccountId,
          }),
        );
      } finally {
        owner.release();
      }
    }),
  );
}

export function createApiRouter(options: CreateApiRouterOptions): express.Router {
  const router = express.Router();
  registerUploadRoute(router, options);
  registerWorkflowRoutes(router, options.client);
  registerStreamingRoute(router, options);
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendError(response, error);
  });
  return router;
}

export function sendServerError(response: Response, error: unknown): void {
  sendError(response, error);
}
