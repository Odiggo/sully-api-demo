import type { TranscriptWord } from './streaming-types.js';

export function parseTranscriptWords(value: unknown): TranscriptWord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const words: TranscriptWord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !('word' in item) || typeof item.word !== 'string') continue;
    words.push({
      word: item.word,
      start: 'start' in item && typeof item.start === 'number' ? item.start : undefined,
      end: 'end' in item && typeof item.end === 'number' ? item.end : undefined,
      confidence:
        'confidence' in item && typeof item.confidence === 'number' ? item.confidence : undefined,
      punctuated_word:
        'punctuated_word' in item && typeof item.punctuated_word === 'string'
          ? item.punctuated_word
          : undefined,
    });
  }
  return words;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseStreamingMessage(message: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(message);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
