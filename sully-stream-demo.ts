import { Command } from 'commander';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import mic from 'node-microphone';
import WebSocket from 'ws';

import { buildStreamingWebSocketUrl } from './streaming-client.js';

dotenv.config();

const STREAMING_DEMO_DURATION = 10;

interface Environment {
  apiUrl: string;
  apiKey: string;
  accountId: string;
}

function loadEnvironment(): Environment {
  const required = {
    SULLY_API_URL: process.env.SULLY_API_URL,
    SULLY_API_KEY: process.env.SULLY_API_KEY,
    SULLY_ACCOUNT_ID: process.env.SULLY_ACCOUNT_ID,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    apiUrl: required.SULLY_API_URL!,
    apiKey: required.SULLY_API_KEY!,
    accountId: required.SULLY_ACCOUNT_ID!,
  };
}

const logger = {
  step: (message: string) => console.log(`\n${message}`),
  info: (message: string) => console.log(message),
  success: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};

function readStreamingToken(payload: unknown): string {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('data' in payload) ||
    typeof payload.data !== 'object' ||
    payload.data === null ||
    !('token' in payload.data) ||
    typeof payload.data.token !== 'string' ||
    payload.data.token.length === 0
  ) {
    throw new Error('Streaming token response did not include a token');
  }
  return payload.data.token;
}

async function requestStreamingToken(environment: Environment): Promise<string> {
  const response = await fetch(
    `${environment.apiUrl}/v1/audio/transcriptions/stream/token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': environment.apiKey,
        'x-account-id': environment.accountId,
      },
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  if (!response.ok) {
    throw new Error(`Streaming token request failed with status ${response.status}`);
  }
  return readStreamingToken(await response.json());
}

async function demonstrateStreaming({
  mode,
  duration,
  language,
}: {
  mode: 'client' | 'server';
  duration: number;
  language?: string;
}): Promise<void> {
  const environment = loadEnvironment();
  logger.step('Starting live audio streaming demo');
  logger.info(`Demo will run for ${duration} seconds.`);

  const token = mode === 'client' ? await requestStreamingToken(environment) : undefined;
  const streamConnectionParams = {
    apiUrl: `${environment.apiUrl}/v1`,
    sampleRate: 16000,
    encoding: 'linear16',
    dictation: true,
    language,
  } as const;
  const wsUrl = buildStreamingWebSocketUrl({
    ...streamConnectionParams,
    accountId: token ? environment.accountId : undefined,
    apiToken: token,
  });

  logger.info(
    `Connecting to WebSocket: ${buildStreamingWebSocketUrl(streamConnectionParams)}`,
  );

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: token
        ? {}
        : {
            'x-api-key': environment.apiKey,
            'x-account-id': environment.accountId,
          },
    });
    const microphone = new mic({ rate: 16000, channels: 1, bitwidth: 16 });
    let countdown: NodeJS.Timeout | undefined;
    let durationTimer: NodeJS.Timeout | undefined;

    const stop = () => {
      if (countdown) clearInterval(countdown);
      if (durationTimer) clearTimeout(durationTimer);
      process.off('SIGINT', stop);
      microphone.stopRecording();
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    process.once('SIGINT', stop);

    ws.on('open', () => {
      logger.info('Streaming active. Start speaking.');
      const micStream = microphone.startRecording();
      micStream.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ audio: data.toString('base64') }));
        }
      });

      let secondsLeft = duration;
      countdown = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          process.stdout.write(`Time remaining: ${secondsLeft} seconds\r`);
        }
      }, 1000);
      durationTimer = setTimeout(() => {
        stop();
        logger.success(`Streaming demo completed after ${duration} seconds.`);
      }, duration * 1000);
    });

    ws.on('message', (data) => {
      try {
        const payload: unknown = JSON.parse(data.toString());
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'text' in payload &&
          typeof payload.text === 'string'
        ) {
          console.log(payload.text);
        }
      } catch (error) {
        logger.error(`Unable to parse streaming message: ${String(error)}`);
      }
    });
    ws.on('error', (error) => {
      stop();
      reject(error);
    });
    ws.on('close', (code, reason) => {
      stop();
      logger.info(`WebSocket closed: ${code} ${reason.toString()}`);
      resolve();
    });
  });
}

interface StreamOptions {
  duration: string;
  mode: string;
  language?: string;
}

const program = new Command()
  .name('sully-stream-demo')
  .description('Run a Sully live audio streaming demo')
  .version('0.1.0')
  .option('-d, --duration <seconds>', 'duration in seconds', `${STREAMING_DEMO_DURATION}`)
  .option('-m, --mode <mode>', 'authentication mode (client|server)', 'server')
  .option('-l, --language <language>', 'language code, for example en-US')
  .action(async (options: StreamOptions) => {
    const duration = Number(options.duration);
    if (!Number.isInteger(duration) || duration <= 0) {
      throw new Error('Duration must be a positive integer');
    }
    if (options.mode !== 'client' && options.mode !== 'server') {
      throw new Error('Mode must be client or server');
    }
    await demonstrateStreaming({
      duration,
      mode: options.mode,
      language: options.language,
    });
  });

const argumentsWithoutPnpmSeparator =
  process.argv[2] === '--'
    ? [process.argv[0], process.argv[1], ...process.argv.slice(3)]
    : process.argv;

await program.parseAsync(argumentsWithoutPnpmSeparator);
