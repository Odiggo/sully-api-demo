/**
 * Browser demo UI helpers (settings persistence, health, banners).
 */
import {
  DEFAULT_STREAMING_LANGUAGE_TAG,
  MULTILINGUAL_LANGUAGE_TAG,
  SUPPORTED_LANGUAGES,
} from './languages.js';

export const STORAGE_KEYS = {
  language: 'sully-demo:language',
  duration: 'sully-demo:duration',
  dictation: 'sully-demo:dictation',
  wordDebug: 'sully-demo:wordDebug',
} as const;

export interface DemoSettings {
  language: string;
  durationSec: number;
  dictation: boolean;
  wordDebug: boolean;
}

export interface HealthStatus {
  ok: boolean;
  hasApiKey: boolean;
  hasAccountId: boolean;
  hasApiUrl: boolean;
}

const ALL_LANGUAGE_TAGS = new Set(
  SUPPORTED_LANGUAGES.flatMap((entry) => entry.tags),
);

export function loadSettings(): DemoSettings {
  const language = localStorage.getItem(STORAGE_KEYS.language) ?? DEFAULT_STREAMING_LANGUAGE_TAG;
  const durationRaw = localStorage.getItem(STORAGE_KEYS.duration) ?? '0';
  const durationSec = Number.parseInt(durationRaw, 10);

  return {
    language: ALL_LANGUAGE_TAGS.has(language) ? language : DEFAULT_STREAMING_LANGUAGE_TAG,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    dictation: localStorage.getItem(STORAGE_KEYS.dictation) === 'true',
    wordDebug: localStorage.getItem(STORAGE_KEYS.wordDebug) === 'true',
  };
}

export function saveSettings(settings: Partial<DemoSettings>): void {
  if (settings.language !== undefined) {
    localStorage.setItem(STORAGE_KEYS.language, settings.language);
  }
  if (settings.durationSec !== undefined) {
    localStorage.setItem(STORAGE_KEYS.duration, String(settings.durationSec));
  }
  if (settings.dictation !== undefined) {
    localStorage.setItem(STORAGE_KEYS.dictation, settings.dictation ? 'true' : 'false');
  }
  if (settings.wordDebug !== undefined) {
    localStorage.setItem(STORAGE_KEYS.wordDebug, settings.wordDebug ? 'true' : 'false');
  }
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await fetch('/health');
  if (!response.ok) {
    return {
      ok: false,
      hasApiKey: false,
      hasAccountId: false,
      hasApiUrl: false,
    };
  }
  return (await response.json()) as HealthStatus;
}

export function formatEndReason(
  reason: string,
): string {
  switch (reason) {
    case 'manual':
      return 'You stopped recording';
    case 'timer':
      return 'Timer ended the session';
    case 'server':
      return 'Server closed the stream';
    case 'connection_lost':
      return 'Connection lost after retries';
    case 'error':
      return 'Session ended with an error';
    default:
      return 'Session ended';
  }
}

export function formatActiveConfig(
  language: string,
  durationSec: number,
  dictation: boolean,
): string {
  const durationLabel =
    durationSec > 0 ? `${durationSec}s` : 'manual';
  const dictationLabel = dictation ? 'dictation' : 'conversation';
  return `${language} · ${durationLabel} · ${dictationLabel}`;
}

export function populateLanguageSelect(select: HTMLSelectElement): void {
  const previous = select.value;

  select.innerHTML = '';

  const multi = document.createElement('option');
  multi.value = MULTILINGUAL_LANGUAGE_TAG;
  multi.textContent = 'Multilingual (auto-detect)';
  select.appendChild(multi);

  for (const { name, tags } of SUPPORTED_LANGUAGES) {
    const group = document.createElement('optgroup');
    group.label = name;

    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tags.length > 1 ? `${name} (${tag})` : name;
      group.appendChild(option);
    }

    select.appendChild(group);
  }

  if (previous && [...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  } else {
    select.value = DEFAULT_STREAMING_LANGUAGE_TAG;
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
