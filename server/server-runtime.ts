import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type express from 'express';

import type { TimerScheduler } from '../contracts/index.js';
import type { DemoLogger } from './demo-logger.js';
import type { ServerConfig } from './server-config.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const SHUTDOWN_GRACE_MS = 5_000;
const UPLOAD_DIRECTORY_PREFIX = 'sully-api-demo-uploads-';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface GracefulShutdownRegistration {
  completion: Promise<void>;
  dispose(): void;
}

export interface RegisterGracefulShutdownOptions {
  server: {
    close(callback: (error?: Error) => void): unknown;
    closeAllConnections(): void;
  };
  signalSource: {
    once(signal: ShutdownSignal, listener: () => void): void;
    off(signal: ShutdownSignal, listener: () => void): void;
  };
  cleanup: () => Promise<void>;
  logger: DemoLogger;
  setExitCode: (code: number) => void;
  graceMs?: number;
  timers?: TimerScheduler;
}

export interface StartServerOptions {
  app: express.Express;
  config: ServerConfig;
  logger: DemoLogger;
}

export interface StartManagedServerOptions extends StartServerOptions {
  openUrl: (url: string) => Promise<void>;
  signalSource: RegisterGracefulShutdownOptions['signalSource'];
  cleanup: () => Promise<void>;
  setExitCode: (code: number) => void;
  graceMs?: number;
  timers?: TimerScheduler;
}

export interface ManagedServer {
  server: Server;
  shutdown: GracefulShutdownRegistration;
}

const defaultTimers: TimerScheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function safeLog(operation: () => void): void {
  try {
    operation();
  } catch {
    // Runtime ownership cannot depend on telemetry availability.
  }
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
  safeLog(() => options.logger.info({ event: 'server_listening', port: address.port }));
  return server;
}

async function openPlayground(
  server: Server,
  options: Pick<StartManagedServerOptions, 'config' | 'logger' | 'openUrl'>,
): Promise<void> {
  if (!options.config.openBrowser) return;
  const address = server.address();
  if (!address || typeof address === 'string') return;
  try {
    await options.openUrl(`http://${LOOPBACK_HOST}:${address.port}/`);
  } catch {
    safeLog(() => options.logger.warn({ event: 'browser_open_failed' }));
  }
}

export async function startManagedServer(
  options: StartManagedServerOptions,
): Promise<ManagedServer> {
  const server = await startServer(options);
  const shutdown = registerGracefulShutdown({
    server,
    signalSource: options.signalSource,
    cleanup: options.cleanup,
    logger: options.logger,
    setExitCode: options.setExitCode,
    graceMs: options.graceMs,
    timers: options.timers,
  });
  void openPlayground(server, options);
  return { server, shutdown };
}

export function createProcessUploadDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), UPLOAD_DIRECTORY_PREFIX));
}

function closeServer(
  server: RegisterGracefulShutdownOptions['server'],
  graceMs: number,
  timers: TimerScheduler,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeoutHandle);
      if (error) reject(error);
      else resolve();
    };
    const timeoutHandle = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        server.closeAllConnections();
        resolve();
      } catch (error: unknown) {
        reject(error);
      }
    }, graceMs);
    try {
      server.close(finish);
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error('Server close failed'));
    }
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
        await closeServer(
          options.server,
          options.graceMs ?? SHUTDOWN_GRACE_MS,
          options.timers ?? defaultTimers,
        );
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
        safeLog(() => options.logger.error({ event: 'shutdown_failed' }));
      } else {
        safeLog(() => options.logger.info({ event: 'server_stopped' }));
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
