/**
 * Supported transcription languages — see:
 * https://docs.sully.ai/api-reference/audio-transcriptions/languages
 */
export interface SupportedLanguage {
  name: string;
  tags: readonly string[];
}

/** Auto-detect multiple languages in one stream (nl, fr, de, hi, it, ja, pt, ru, es). */
export const MULTILINGUAL_LANGUAGE_TAG = 'multi';

export const DEFAULT_STREAMING_LANGUAGE_TAG = 'en-US';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { name: 'Bulgarian', tags: ['bg'] },
  { name: 'Catalan', tags: ['ca'] },
  { name: 'Chinese (Mandarin, Simplified)', tags: ['zh', 'zh-CN', 'zh-Hans'] },
  { name: 'Chinese (Mandarin, Traditional)', tags: ['zh-TW', 'zh-Hant'] },
  { name: 'Chinese (Cantonese, Traditional)', tags: ['zh-HK'] },
  { name: 'Czech', tags: ['cs'] },
  { name: 'Danish', tags: ['da', 'da-DK'] },
  { name: 'Dutch', tags: ['nl'] },
  { name: 'English', tags: ['en', 'en-US', 'en-AU', 'en-GB', 'en-NZ', 'en-IN'] },
  { name: 'Estonian', tags: ['et'] },
  { name: 'Finnish', tags: ['fi'] },
  { name: 'Flemish', tags: ['nl-BE'] },
  { name: 'French', tags: ['fr', 'fr-CA'] },
  { name: 'German', tags: ['de'] },
  { name: 'German (Switzerland)', tags: ['de-CH'] },
  { name: 'Greek', tags: ['el'] },
  { name: 'Hindi', tags: ['hi'] },
  { name: 'Hungarian', tags: ['hu'] },
  { name: 'Indonesian', tags: ['id'] },
  { name: 'Italian', tags: ['it'] },
  { name: 'Japanese', tags: ['ja'] },
  { name: 'Korean', tags: ['ko', 'ko-KR'] },
  { name: 'Latvian', tags: ['lv'] },
  { name: 'Lithuanian', tags: ['lt'] },
  { name: 'Malay', tags: ['ms'] },
  { name: 'Norwegian', tags: ['no'] },
  { name: 'Polish', tags: ['pl'] },
  { name: 'Portuguese', tags: ['pt', 'pt-BR', 'pt-PT'] },
  { name: 'Romanian', tags: ['ro'] },
  { name: 'Russian', tags: ['ru'] },
  { name: 'Slovak', tags: ['sk'] },
  { name: 'Spanish', tags: ['es', 'es-419'] },
  { name: 'Swedish', tags: ['sv', 'sv-SE'] },
  { name: 'Thai', tags: ['th', 'th-TH'] },
  { name: 'Turkish', tags: ['tr'] },
  { name: 'Ukrainian', tags: ['uk'] },
  { name: 'Vietnamese', tags: ['vi'] },
] as const;
