import {
  streamingTokenBrokerResponseSchema,
  type StreamingTokenBrokerResponse,
} from './contracts/index.js';

export type StreamingToken = StreamingTokenBrokerResponse;

interface BuildStreamingWebSocketUrlParams {
  apiUrl: string;
  sampleRate: number;
  encoding: string;
  dictation: boolean;
  language?: string;
  accountId?: string;
  apiToken?: string;
}

const normalizeOptionalString = ({
  value,
}: {
  value?: unknown;
}): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

export const buildStreamingWebSocketUrl = ({
  apiUrl,
  sampleRate,
  encoding,
  dictation,
  language,
  accountId,
  apiToken,
}: BuildStreamingWebSocketUrlParams): string => {
  const websocketBaseUrl = apiUrl
    .trim()
    .replace(/\/+$/, '')
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');

  const params = new URLSearchParams({
    sample_rate: `${sampleRate}`,
    encoding,
  });

  if (dictation) {
    params.set('dictation', 'true');
  }

  const normalizedLanguage = normalizeOptionalString({ value: language });
  if (normalizedLanguage) {
    params.set('language', normalizedLanguage);
  }

  const normalizedAccountId = normalizeOptionalString({ value: accountId });
  if (normalizedAccountId) {
    params.set('account_id', normalizedAccountId);
  }

  const normalizedApiToken = normalizeOptionalString({ value: apiToken });
  if (normalizedApiToken) {
    params.set('api_token', normalizedApiToken);
  }

  return `${websocketBaseUrl}/audio/transcriptions/stream?${params.toString()}`;
};

export const parseStreamingTokenResponse = ({
  value,
}: {
  value: unknown;
}): StreamingToken => {
  const parsed = streamingTokenBrokerResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid streaming token response');
  }
  return parsed.data;
};
