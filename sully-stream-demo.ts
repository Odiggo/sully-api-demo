import { Command } from 'commander';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import mic from 'node-microphone';
import WebSocket from 'ws';

import { upstreamStreamingTokenSchema } from './contracts/index.js';
import { buildStreamingWebSocketUrl } from './streaming-client.js';
import { parseStreamingMessage } from './streaming-message.js';

dotenv.config();

const STREAMING_DEMO_DURATION = 10;

interface Environment {
  apiUrl: string;
  apiKey: string;
  accountId: string;
}

function loadEnvironment(): Environment {
  const apiUrl = process.env.SULLY_API_URL;
  const apiKey = process.env.SULLY_API_KEY;
  const accountId = process.env.SULLY_ACCOUNT_ID;
  if (!apiUrl || !apiKey || !accountId) {
    const missing = [
      !apiUrl && 'SULLY_API_URL',
      !apiKey && 'SULLY_API_KEY',
      !accountId && 'SULLY_ACCOUNT_ID',
    ].filter((name): name is string => Boolean(name));
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return { apiUrl, apiKey, accountId };
}

const logger = {
  step: (message: string) => console.log(`\n${message}`),
  info: (message: string) => console.log(message),
  success: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};

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
  return upstreamStreamingTokenSchema.parse(await response.json()).token;
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
    let microphoneStarted = false;
    let settled = false;

    const stopTransport = () => {
      if (countdown) clearInterval(countdown);
      if (durationTimer) clearTimeout(durationTimer);
      process.off('SIGINT', handleInterrupt);
      microphone.stopRecording();
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stopTransport();
      if (error) reject(error);
      else resolve();
    };

    const handleInterrupt = () => finish();

    const startMicrophone = () => {
      if (microphoneStarted || settled) return;
      microphoneStarted = true;
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
    };

    process.once('SIGINT', handleInterrupt);
    // Runtime extends EventEmitter, but node-microphone's declaration omits it.
    (microphone as mic & { on(event: 'error', listener: (error: Error) => void): void }).on(
      'error',
      (error) => finish(error),
    );

    ws.on('open', () => {
      logger.info('WebSocket open. Waiting for provider readiness.');
    });

    ws.on('message', (data) => {
      const payload = parseStreamingMessage(data.toString());
      if (!payload) {
        logger.error('Unable to parse streaming message');
        return;
      }
      if (payload.status === 'connected') startMicrophone();
      if (typeof payload.text === 'string') console.log(payload.text);
    });
    ws.on('error', (error) => finish(error));
    ws.on('close', (code, reason) => {
      logger.info(`WebSocket closed: ${code} ${reason.toString()}`);
      finish();
    });
    durationTimer = setTimeout(() => {
      logger.success(`Streaming demo completed after ${duration} seconds.`);
      finish();
    }, duration * 1000);
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
