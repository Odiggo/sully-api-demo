import { z } from 'zod';

import {
  codingIdSchema,
  nonBlankStringSchema,
  providerTimestampSchema,
} from './common-contracts.js';

export const codingRequestSchema = z.strictObject({
  text: nonBlankStringSchema,
});

export type CodingRequest = z.infer<typeof codingRequestSchema>;

const codingValueSchema = z.union([nonBlankStringSchema, z.number().int().nonnegative()]);

const codingItemSchema = z.looseObject({
  system: nonBlankStringSchema,
  code: codingValueSchema,
  display: nonBlankStringSchema,
});

const codingConceptSchema = z.looseObject({
  coding: z.array(codingItemSchema),
  text: nonBlankStringSchema,
});

const sourceSpanSchema = z
  .looseObject({
    start_char: z.number().int().nonnegative(),
    end_char: z.number().int().nonnegative(),
    text: z.string(),
  })
  .refine((span) => span.end_char >= span.start_char, {
    message: 'Source span end must not precede start',
    path: ['end_char'],
  });

const codedFindingSchema = z.looseObject({
  id: nonBlankStringSchema,
  code: codingConceptSchema,
  text_span: sourceSpanSchema,
});

const codingBaseShape = {
  id: codingIdSchema,
  created_at: providerTimestampSchema,
  updated_at: providerTimestampSchema,
  processing_time_ms: z.number().finite().nonnegative().optional(),
};

const codingDataSchema = z.union([
  z.looseObject({ ...codingBaseShape, status: z.enum(['pending', 'processing', 'failed']) }),
  z.looseObject({
    ...codingBaseShape,
    status: z.literal('completed'),
    result: z.looseObject({
      diagnoses: z.array(codedFindingSchema),
      procedures: z.array(codedFindingSchema),
    }),
  }),
]);

export const codingResponseSchema = z.looseObject({ data: codingDataSchema });

export type CodingResponse = z.infer<typeof codingResponseSchema>;
