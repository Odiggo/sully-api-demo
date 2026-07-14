export const STREAMING_STORAGE_KEYS = {
  language: 'sully-playground:streaming-language',
  tokenExpiresIn: 'sully-playground:streaming-token-expiry',
  dictation: 'sully-playground:streaming-dictation',
  wordDebug: 'sully-playground:streaming-word-debug',
} as const;

export interface StreamingPreferences {
  language: string;
  tokenExpiresIn: number;
  dictation: boolean;
  wordDebug: boolean;
}

const ALLOWED_TOKEN_EXPIRIES = new Set([300, 3_600, 86_400]);

export function loadStreamingPreferences(): StreamingPreferences {
  const tokenValue = Number.parseInt(
    localStorage.getItem(STREAMING_STORAGE_KEYS.tokenExpiresIn) ?? '',
    10,
  );
  return {
    language: localStorage.getItem(STREAMING_STORAGE_KEYS.language) ?? 'en',
    tokenExpiresIn: ALLOWED_TOKEN_EXPIRIES.has(tokenValue) ? tokenValue : 3_600,
    dictation: localStorage.getItem(STREAMING_STORAGE_KEYS.dictation) !== 'false',
    wordDebug: localStorage.getItem(STREAMING_STORAGE_KEYS.wordDebug) === 'true',
  };
}

export function saveStreamingPreferences(preferences: StreamingPreferences): void {
  localStorage.setItem(STREAMING_STORAGE_KEYS.language, preferences.language);
  localStorage.setItem(
    STREAMING_STORAGE_KEYS.tokenExpiresIn,
    String(preferences.tokenExpiresIn),
  );
  localStorage.setItem(
    STREAMING_STORAGE_KEYS.dictation,
    String(preferences.dictation),
  );
  localStorage.setItem(
    STREAMING_STORAGE_KEYS.wordDebug,
    String(preferences.wordDebug),
  );
}
