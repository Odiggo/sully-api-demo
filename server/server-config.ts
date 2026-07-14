import dotenv from 'dotenv';

import {
  CREDENTIAL_NAMES,
  type CredentialName,
  type HealthResponse,
  healthResponseSchema,
  parseApprovedSullyOrigin,
} from '../contracts/index.js';

export const DEFAULT_PORT = 3_000;

export type CredentialState =
  | {
      ready: true;
      apiUrl: URL;
      apiKey: string;
      accountId: string;
    }
  | {
      ready: false;
      missing: CredentialName[];
      invalid: CredentialName[];
    };

export interface ServerConfig {
  port: number;
  openBrowser: boolean;
  credentials: CredentialState;
}

export interface LoadServerConfigOptions {
  envFilePath?: string;
  processEnv?: NodeJS.ProcessEnv;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const port = Number(value);
  if (port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port;
}

function parseOpenBrowser(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('SULLY_DEMO_OPEN_BROWSER must be true or false');
}

function normalizeCredential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  return trimmed;
}

function parseApiUrl(value: string): URL | undefined {
  return parseApprovedSullyOrigin(value);
}

function parseCredentials(env: NodeJS.ProcessEnv): CredentialState {
  const values = {
    SULLY_API_URL: normalizeCredential(env.SULLY_API_URL),
    SULLY_API_KEY: normalizeCredential(env.SULLY_API_KEY),
    SULLY_ACCOUNT_ID: normalizeCredential(env.SULLY_ACCOUNT_ID),
  };
  const missing = CREDENTIAL_NAMES.filter((name) => values[name] === undefined);
  const invalid: CredentialName[] = [];
  const apiUrl = values.SULLY_API_URL ? parseApiUrl(values.SULLY_API_URL) : undefined;
  const apiKey = values.SULLY_API_KEY;
  const accountId = values.SULLY_ACCOUNT_ID;
  if (values.SULLY_API_URL && !apiUrl) invalid.push('SULLY_API_URL');

  if (missing.length > 0 || invalid.length > 0 || !apiUrl || !apiKey || !accountId) {
    return { ready: false, missing: [...missing], invalid };
  }

  return {
    ready: true,
    apiUrl,
    apiKey,
    accountId,
  };
}

export function parseServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: parsePort(env.PORT),
    openBrowser: parseOpenBrowser(env.SULLY_DEMO_OPEN_BROWSER),
    credentials: parseCredentials(env),
  };
}

export function loadServerConfig(options: LoadServerConfigOptions = {}): ServerConfig {
  const processEnv = Object.fromEntries(
    Object.entries(options.processEnv ?? process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const result = dotenv.config({
    path: options.envFilePath,
    processEnv,
    override: false,
  });
  if (options.envFilePath && result.error) {
    throw new Error('Unable to load environment configuration');
  }
  return parseServerConfig(processEnv);
}

export function toHealthResponse(config: ServerConfig): HealthResponse {
  const health = config.credentials.ready
    ? { ok: true, missing: [], invalid: [] }
    : {
        ok: false,
        missing: config.credentials.missing,
        invalid: config.credentials.invalid,
      };
  return healthResponseSchema.parse(health);
}
