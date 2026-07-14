import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessLogger } from './server/demo-logger.js';
import { createServerApp } from './server/server-app.js';
import { loadServerConfig } from './server/server-config.js';
import { openExternalUrl, startServer } from './server/server-runtime.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(currentDirectory, '..', '..');
const uploadDirectory = path.join(tmpdir(), 'sully-api-demo-uploads');
const logger = createProcessLogger();

async function main(): Promise<void> {
  const config = loadServerConfig();
  const app = await createServerApp({
    config,
    logger,
    uploadDirectory,
    rootDirectory,
    createRequestId: randomUUID,
  });
  await startServer({ app, config, openUrl: openExternalUrl, logger });
}

try {
  await main();
} catch {
  logger.error({ event: 'startup_failed' });
  process.exitCode = 1;
}
