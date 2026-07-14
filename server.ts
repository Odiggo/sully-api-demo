import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessLogger } from './server/demo-logger.js';
import { createServerApp } from './server/server-app.js';
import { loadServerConfig } from './server/server-config.js';
import {
  createProcessUploadDirectory,
  openExternalUrl,
  registerGracefulShutdown,
  startServer,
} from './server/server-runtime.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(currentDirectory, '..', '..');
const logger = createProcessLogger();

async function main(): Promise<void> {
  const config = loadServerConfig();
  const uploadDirectory = await createProcessUploadDirectory();
  try {
    const app = await createServerApp({
      config,
      logger,
      uploadDirectory,
      rootDirectory,
      createRequestId: randomUUID,
    });
    const server = await startServer({ app, config, openUrl: openExternalUrl, logger });
    registerGracefulShutdown({
      server,
      signalSource: {
        once: (signal, listener) => {
          process.once(signal, listener);
        },
        off: (signal, listener) => {
          process.off(signal, listener);
        },
      },
      cleanup: () => rm(uploadDirectory, { recursive: true, force: true }),
      logger,
      setExitCode: (code) => {
        process.exitCode = code;
      },
    });
  } catch (error: unknown) {
    try {
      await rm(uploadDirectory, { recursive: true, force: true });
    } catch {
      // Startup failure remains the primary outcome.
    }
    throw error;
  }
}

try {
  await main();
} catch {
  logger.error({ event: 'startup_failed' });
  process.exitCode = 1;
}
