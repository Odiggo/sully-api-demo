import { z } from 'zod';

import {
  jsonObjectSchema,
  nonBlankStringSchema,
  noteIdSchema,
  providerTimestampSchema,
} from './common-contracts.js';

export const NOTE_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh'] as const;
export const noteLanguageSchema = z.enum(NOTE_LANGUAGES);

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate);
const encounterDateTimeSchema = z.iso.datetime({ offset: false, precision: 0 });
export const encounterDateSchema = z.union([dateOnlySchema, encounterDateTimeSchema]);

const patientInfoSchema = z.strictObject({
  name: nonBlankStringSchema.optional(),
  dateOfBirth: dateOnlySchema.optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer not to say', 'unspecified']).optional(),
});

export const noteRequestSchema = z.strictObject({
  transcript: nonBlankStringSchema,
  date: encounterDateSchema,
  language: noteLanguageSchema.default('en'),
  noteType: z.strictObject({
    description: nonBlankStringSchema.optional(),
    type: z.literal('note_style'),
    template: nonBlankStringSchema,
    includeJson: z.boolean().default(false),
  }),
  patientInfo: patientInfoSchema.optional(),
  previousNote: nonBlankStringSchema.optional(),
  context: nonBlankStringSchema.nullable().optional(),
  instructions: z.array(nonBlankStringSchema).nullable().optional(),
  medicationList: nonBlankStringSchema.optional(),
});

export type NoteRequest = z.infer<typeof noteRequestSchema>;

export const noteCreateResponseSchema = z.looseObject({
  status: z.literal('ok'),
  data: z.looseObject({ noteId: noteIdSchema }),
  date: providerTimestampSchema,
});

export type NoteCreateResponse = z.infer<typeof noteCreateResponseSchema>;

const noteTimestampSchema = z.looseObject({
  start: z.number().int().nonnegative(),
  complete: z.number().int().nonnegative().optional(),
});

const notePayloadSchema = z
  .looseObject({
    markdown: z.string().optional(),
    json: jsonObjectSchema.optional(),
  })
  .refine((payload) => Boolean(payload.markdown?.trim()) || payload.json !== undefined, {
    message: 'Completed note requires markdown or JSON',
  });

const noteBaseShape = {
  id: noteIdSchema,
  timestamp: noteTimestampSchema.optional(),
};

const noteDataSchema = z.union([
  z.looseObject({ ...noteBaseShape, status: z.literal('STATUS_PROCESSING') }),
  z.looseObject({
    ...noteBaseShape,
    status: z.literal('STATUS_DONE'),
    payload: notePayloadSchema,
  }),
  z.looseObject({ ...noteBaseShape, status: z.literal('STATUS_ERROR') }),
]);

export const noteResponseSchema = z.looseObject({
  status: z.literal('ok'),
  data: noteDataSchema,
  date: providerTimestampSchema,
});

export type NoteResponse = z.infer<typeof noteResponseSchema>;
