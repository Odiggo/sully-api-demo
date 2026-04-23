export interface StreamingToken {
  token: string;
  apiUrl: string;
  accountId: string;
}

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

const isStreamingTokenRecord = (
  value: unknown,
): value is Record<keyof StreamingToken, string> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const token = normalizeOptionalString({
    value: Reflect.get(value, 'token'),
  });
  const apiUrl = normalizeOptionalString({
    value: Reflect.get(value, 'apiUrl'),
  });
  const accountId = normalizeOptionalString({
    value: Reflect.get(value, 'accountId'),
  });

  return Boolean(token && apiUrl && accountId);
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
  if (!isStreamingTokenRecord(value)) {
    throw new Error('Invalid streaming token response');
  }

  return {
    token: value.token,
    apiUrl: value.apiUrl,
    accountId: value.accountId,
  };
};
