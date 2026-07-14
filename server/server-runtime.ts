import { execFile } from 'node:child_process';
import type { Server } from 'node:http';

import type express from 'express';

import type { DemoLogger } from './demo-logger.js';
import type { ServerConfig } from './server-config.js';

export const LOOPBACK_HOST = '127.0.0.1';

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
