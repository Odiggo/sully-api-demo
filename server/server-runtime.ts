import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type express from 'express';

import type { DemoLogger } from './demo-logger.js';
import type { ServerConfig } from './server-config.js';

export const LOOPBACK_HOST = '127.0.0.1';
const UPLOAD_DIRECTORY_PREFIX = 'sully-api-demo-uploads-';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface GracefulShutdownRegistration {
  completion: Promise<void>;
  dispose(): void;
}

export interface RegisterGracefulShutdownOptions {
  server: { close(callback: (error?: Error) => void): unknown };
  signalSource: {
    once(signal: ShutdownSignal, listener: () => void): void;
    off(signal: ShutdownSignal, listener: () => void): void;
  };
  cleanup: () => Promise<void>;
  logger: DemoLogger;
  setExitCode: (code: number) => void;
}

export interface StartServerOptions {
  app: express.Express;
  config: ServerConfig;
  openUrl: (url: string) => Promise<void>;
  logger: DemoLogger;
}

function waitForListener(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };
    const handleError = (error: Error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    server.once('listening', handleListening);
    server.once('error', handleError);
  });
}

export async function startServer(options: StartServerOptions): Promise<Server> {
  const server = options.app.listen(options.config.port, LOOPBACK_HOST);
  await waitForListener(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Server listener address is unavailable');
  }
  options.logger.info({ event: 'server_listening', port: address.port });
  if (options.config.openBrowser) {
    try {
      await options.openUrl(`http://${LOOPBACK_HOST}:${address.port}/`);
    } catch {
      options.logger.warn({ event: 'browser_open_failed' });
    }
  }
  return server;
}

export function createProcessUploadDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), UPLOAD_DIRECTORY_PREFIX));
}

function closeServer(server: RegisterGracefulShutdownOptions['server']): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function registerGracefulShutdown(
  options: RegisterGracefulShutdownOptions,
): GracefulShutdownRegistration {
  let started = false;
  let resolveCompletion: () => void = () => undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const removeListeners = () => {
    for (const signal of SHUTDOWN_SIGNALS) options.signalSource.off(signal, handleSignal);
  };
  const handleSignal = () => {
    if (started) return;
    started = true;
    removeListeners();
    const shutdown = async () => {
      let failed = false;
      try {
        await closeServer(options.server);
      } catch {
        failed = true;
      }
      try {
        await options.cleanup();
      } catch {
        failed = true;
      }
      if (failed) {
        options.setExitCode(1);
        try {
          options.logger.error({ event: 'shutdown_failed' });
        } catch {
          // Shutdown outcome does not depend on logger availability.
        }
      } else {
        try {
          options.logger.info({ event: 'server_stopped' });
        } catch {
          // Resources are already released.
        }
      }
    };
    void shutdown().finally(resolveCompletion);
  };
  for (const signal of SHUTDOWN_SIGNALS) options.signalSource.once(signal, handleSignal);
  return { completion, dispose: removeListeners };
}

export function openExternalUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32'
      ? 'cmd.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', url] : [url];
    execFile(command, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
