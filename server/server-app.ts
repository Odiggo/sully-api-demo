import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { DemoLogger } from './demo-logger.js';
import { createApiRouter, sendServerError } from './api-routes.js';
import { createSullyApiClient, type SullyApiClient } from './sully-api-client.js';
import { type ServerConfig, toHealthResponse } from './server-config.js';

export const MAX_JSON_BODY_BYTES = 65_536;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface CreateServerAppOptions {
  config: ServerConfig;
  client?: SullyApiClient;
  logger: DemoLogger;
  uploadDirectory: string;
  rootDirectory: string;
  createRequestId: () => string;
  createUploadFilename?: () => string;
  removeUploadFile?: (filePath: string) => Promise<void>;
}

function hostnameFromHostHeader(host: string): string | undefined {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

function isAllowedLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = hostnameFromHostHeader(host);
  return hostname !== undefined && LOOPBACK_HOSTNAMES.has(hostname);
}

function isSameLocalOrigin(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname) &&
      parsed.host === host
    );
  } catch {
    return false;
  }
}

function securityPolicy(config: ServerConfig): string {
  const connectSources = ["'self'"];
  if (config.credentials.ready) {
    connectSources.push(config.credentials.apiUrl.origin);
    const streamingUrl = new URL(config.credentials.apiUrl);
    streamingUrl.protocol = streamingUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    connectSources.push(streamingUrl.origin);
  }
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
  ].join('; ');
}

function sendLocalError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  const requestId =
    typeof response.locals.requestId === 'string' ? response.locals.requestId : 'unavailable';
  response.status(status).json({ error: { code, message, requestId } });
}

function publicFile(rootDirectory: string, relativePath: string): string {
  return path.join(rootDirectory, relativePath);
}

function sendFile(filePath: string) {
  return (_request: Request, response: Response): void => {
    response.sendFile(filePath);
  };
}

function resolveClient(options: CreateServerAppOptions): SullyApiClient | undefined {
  if (options.client) return options.client;
  const credentials = options.config.credentials;
  if (!credentials.ready) return undefined;
  return createSullyApiClient({
    apiUrl: credentials.apiUrl,
    apiKey: credentials.apiKey,
    accountId: credentials.accountId,
  });
}

function registerFoundationMiddleware(
  app: express.Express,
  options: CreateServerAppOptions,
): void {
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set({
      'Content-Security-Policy': securityPolicy(options.config),
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    if (request.path === '/' || request.path === '/health' || request.path.startsWith('/api/')) {
      response.set('Cache-Control', 'no-store');
    }
    next();
  });
  app.use((request, response, next) => {
    const requestId = options.createRequestId();
    response.locals.requestId = SAFE_REQUEST_ID.test(requestId) ? requestId : 'unavailable';
    response.once('finish', () => {
      options.logger.info({
        event: 'request_complete',
        requestId: response.locals.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
      });
    });
    next();
  });
  app.use((request, response, next) => {
    const host = request.get('host');
    const origin = request.get('origin');
    const forbidden =
      !isAllowedLocalHost(host) ||
      request.get('sec-fetch-site') === 'cross-site' ||
      (origin !== undefined && (host === undefined || !isSameLocalOrigin(origin, host)));
    if (forbidden) {
      sendLocalError(response, 403, 'FORBIDDEN_REQUEST', 'Request origin is not allowed');
      return;
    }
    next();
  });
}

function registerApi(
  app: express.Express,
  options: CreateServerAppOptions,
  client: SullyApiClient | undefined,
): void {
  const config = options.config;
  app.get('/health', (_request, response) => response.json(toHealthResponse(config)));
  app.use('/api', (_request, response, next) => {
    if (!config.credentials.ready || !client) {
      sendLocalError(response, 503, 'SETUP_REQUIRED', 'Sully API credentials are not configured');
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: MAX_JSON_BODY_BYTES, strict: true }));
  if (!config.credentials.ready || !client) return;
  app.use(
    '/api',
    createApiRouter({
      client,
      uploadDirectory: options.uploadDirectory,
      logger: options.logger,
      streamingApiUrl: new URL('/v1', config.credentials.apiUrl).toString().replace(/\/$/, ''),
      streamingAccountId: config.credentials.accountId,
      createUploadFilename: options.createUploadFilename ?? (() => `${randomUUID()}.upload`),
      removeUploadFile: options.removeUploadFile,
    }),
  );
}

function registerPublicAssets(app: express.Express, rootDirectory: string): void {
  const route = (publicPath: string, relativePath: string) => {
    app.get(publicPath, sendFile(publicFile(rootDirectory, relativePath)));
  };
  route('/', 'demo.html');
  route('/playground.css', 'playground.css');
  route('/logo-192x192.png', 'logo-192x192.png');
  route('/assets/playground-app.js', 'dist/client/playground-app.js');
  route('/samples/demo-audio.wav', 'audio/demo_audio.wav');
  route(
    '/audio-worklet/pcm-audio-worklet.min.js',
    'node_modules/@speechmatics/browser-audio-input/dist/pcm-audio-worklet.min.js',
  );
}

function registerFallbacks(app: express.Express): void {
  app.use((_request, response) => {
    response.set('Cache-Control', 'no-store');
    sendLocalError(response, 404, 'NOT_FOUND', 'Route not found');
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.set('Cache-Control', 'no-store');
    sendServerError(response, error);
  });
}

export async function createServerApp(options: CreateServerAppOptions): Promise<express.Express> {
  await mkdir(options.uploadDirectory, { recursive: true });
  const app = express();
  const client = resolveClient(options);
  registerFoundationMiddleware(app, options);
  registerApi(app, options, client);
  registerPublicAssets(app, options.rootDirectory);
  registerFallbacks(app);
  return app;
}
