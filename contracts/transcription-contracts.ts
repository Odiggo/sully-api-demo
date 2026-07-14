import { z } from 'zod';

import {
  nonBlankStringSchema,
  providerTimestampSchema,
  transcriptionIdSchema,
} from './common-contracts.js';

export const TRANSCRIPTION_LANGUAGES = [
  'ar',
  'ar-AE',
  'ar-SA',
  'ar-QA',
  'ar-KW',
  'ar-SY',
  'ar-LB',
  'ar-PS',
  'ar-JO',
  'ar-EG',
  'ar-SD',
  'ar-TD',
  'ar-MA',
  'ar-DZ',
  'ar-TN',
  'ar-IQ',
  'ar-IR',
  'be',
  'bn',
  'bs',
  'bg',
  'ca',
  'zh',
  'zh-CN',
  'zh-Hans',
  'zh-TW',
  'zh-Hant',
  'zh-HK',
  'hr',
  'cs',
  'da',
  'da-DK',
  'nl',
  'en',
  'en-US',
  'en-CA',
  'en-IE',
  'en-AU',
  'en-GB',
  'en-NZ',
  'en-IN',
  'et',
  'fi',
  'nl-BE',
  'fr',
  'fr-CA',
  'de',
  'de-CH',
  'el',
  'gu',
  'gu-IN',
  'he',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'kn',
  'ko',
  'ko-KR',
  'lv',
  'lt',
  'mk',
  'ms',
  'mr',
  'no',
  'fa',
  'pl',
  'pt',
  'pt-BR',
  'pt-PT',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'es-419',
  'sv',
  'sv-SE',
  'tl',
  'ta',
  'te',
  'th',
  'th-TH',
  'tr',
  'uk',
  'ur',
  'vi',
] as const;

export const transcriptionLanguageSchema = z.enum(TRANSCRIPTION_LANGUAGES);
export const MAX_AUDIO_FILE_BYTES = 100 * 1024 * 1024;

const transcriptionWordSchema = z
  .looseObject({
    word: nonBlankStringSchema,
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    confidence: z.number().finite().min(0).max(1),
    speaker: z.number().int().nonnegative().optional(),
  })
  .refine((word) => word.end >= word.start, {
    message: 'Word end must not precede start',
    path: ['end'],
  });

const transcriptionChannelSchema = z.looseObject({
  transcript: z.string(),
  confidence: z.number().finite().min(0).max(1),
  words: z.array(transcriptionWordSchema).optional(),
});

const transcriptionBaseShape = {
  id: transcriptionIdSchema,
  created_at: providerTimestampSchema,
  updated_at: providerTimestampSchema,
};

const queuedTranscriptionSchema = z.looseObject({
  ...transcriptionBaseShape,
  status: z.enum(['pending', 'processing']),
});

const completedTranscriptionSchema = z.looseObject({
  ...transcriptionBaseShape,
  status: z.literal('completed'),
  result: z.looseObject({
    channels: z.array(transcriptionChannelSchema),
  }),
});

const failedTranscriptionSchema = z.looseObject({
  ...transcriptionBaseShape,
  status: z.literal('failed'),
  result: z
    .looseObject({
      error: nonBlankStringSchema,
    })
    .optional(),
});

export const transcriptionResponseSchema = z.looseObject({
  data: z.union([
    queuedTranscriptionSchema,
    completedTranscriptionSchema,
    failedTranscriptionSchema,
  ]),
});

export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;
