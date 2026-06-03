/**
 * Browser demo language picker — grouped by language family with main locale tags.
 *
 * Tags match the Sully streaming transcription API.
 * Regional variants
 * are omitted when a base tag (e.g. `ar`) is enough.
 *
 * @see https://docs.sully.ai/api-reference/audio-transcriptions/languages
 */
export interface SupportedLanguage {
  name: string;
  tags: readonly string[];
}

/** Multilingual auto-detect — send as `multi` on the stream (see Sully languages docs). */
export const MULTILINGUAL_LANGUAGE_TAG = 'multi';

export const DEFAULT_STREAMING_LANGUAGE_TAG = 'en-US';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { name: 'Arabic', tags: ['ar', 'ar-SA', 'ar-EG'] },
  { name: 'Belarusian', tags: ['be'] },
  { name: 'Bengali', tags: ['bn'] },
  { name: 'Bosnian', tags: ['bs'] },
  { name: 'Bulgarian', tags: ['bg'] },
  { name: 'Catalan', tags: ['ca'] },
  { name: 'Chinese (Cantonese, Traditional)', tags: ['zh-HK'] },
  { name: 'Chinese (Mandarin, Simplified)', tags: ['zh', 'zh-CN', 'zh-Hans'] },
  { name: 'Chinese (Mandarin, Traditional)', tags: ['zh-TW', 'zh-Hant'] },
  { name: 'Croatian', tags: ['hr'] },
  { name: 'Czech', tags: ['cs'] },
  { name: 'Danish', tags: ['da', 'da-DK'] },
  { name: 'Dutch', tags: ['nl'] },
  { name: 'English', tags: ['en', 'en-US', 'en-CA', 'en-IE', 'en-AU', 'en-GB', 'en-IN', 'en-NZ'] },
  { name: 'Estonian', tags: ['et'] },
  { name: 'Finnish', tags: ['fi'] },
  { name: 'Flemish', tags: ['nl-BE'] },
  { name: 'French', tags: ['fr', 'fr-CA'] },
  { name: 'German', tags: ['de', 'de-CH'] },
  { name: 'Greek', tags: ['el'] },
  { name: 'Gujarati', tags: ['gu', 'gu-IN'] },
  { name: 'Hebrew', tags: ['he'] },
  { name: 'Hindi', tags: ['hi'] },
  { name: 'Hungarian', tags: ['hu'] },
  { name: 'Indonesian', tags: ['id'] },
  { name: 'Italian', tags: ['it'] },
  { name: 'Japanese', tags: ['ja'] },
  { name: 'Kannada', tags: ['kn'] },
  { name: 'Korean', tags: ['ko', 'ko-KR'] },
  { name: 'Latvian', tags: ['lv'] },
  { name: 'Lithuanian', tags: ['lt'] },
  { name: 'Macedonian', tags: ['mk'] },
  { name: 'Malay', tags: ['ms'] },
  { name: 'Marathi', tags: ['mr'] },
  { name: 'Norwegian', tags: ['no'] },
  { name: 'Persian', tags: ['fa'] },
  { name: 'Polish', tags: ['pl'] },
  { name: 'Portuguese', tags: ['pt', 'pt-BR', 'pt-PT'] },
  { name: 'Romanian', tags: ['ro'] },
  { name: 'Russian', tags: ['ru'] },
  { name: 'Serbian', tags: ['sr'] },
  { name: 'Slovak', tags: ['sk'] },
  { name: 'Slovenian', tags: ['sl'] },
  { name: 'Spanish', tags: ['es', 'es-419'] },
  { name: 'Swedish', tags: ['sv', 'sv-SE'] },
  { name: 'Tagalog', tags: ['tl'] },
  { name: 'Tamil', tags: ['ta'] },
  { name: 'Telugu', tags: ['te'] },
  { name: 'Thai', tags: ['th', 'th-TH'] },
  { name: 'Turkish', tags: ['tr'] },
  { name: 'Ukrainian', tags: ['uk'] },
  { name: 'Urdu', tags: ['ur'] },
  { name: 'Vietnamese', tags: ['vi'] },
] as const;
