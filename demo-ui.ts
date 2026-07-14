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

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readStorage(storage: PreferenceStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(
  storage: PreferenceStorage | undefined,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Preferences remain optional when browser storage is unavailable.
  }
}

export function loadStreamingPreferences(
  storage: PreferenceStorage | undefined = browserStorage(),
): StreamingPreferences {
  const tokenValue = Number.parseInt(
    readStorage(storage, STREAMING_STORAGE_KEYS.tokenExpiresIn) ?? '',
    10,
  );
  return {
    language: readStorage(storage, STREAMING_STORAGE_KEYS.language) ?? 'en',
    tokenExpiresIn: ALLOWED_TOKEN_EXPIRIES.has(tokenValue) ? tokenValue : 3_600,
    dictation: readStorage(storage, STREAMING_STORAGE_KEYS.dictation) !== 'false',
    wordDebug: readStorage(storage, STREAMING_STORAGE_KEYS.wordDebug) === 'true',
  };
}

export function saveStreamingPreferences(
  preferences: StreamingPreferences,
  storage: PreferenceStorage | undefined = browserStorage(),
): void {
  writeStorage(storage, STREAMING_STORAGE_KEYS.language, preferences.language);
  writeStorage(
    storage,
    STREAMING_STORAGE_KEYS.tokenExpiresIn,
    String(preferences.tokenExpiresIn),
  );
  writeStorage(
    storage,
    STREAMING_STORAGE_KEYS.dictation,
    String(preferences.dictation),
  );
  writeStorage(
    storage,
    STREAMING_STORAGE_KEYS.wordDebug,
    String(preferences.wordDebug),
  );
}
