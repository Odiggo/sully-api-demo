import { z } from 'zod';

import {
  jsonObjectSchema,
  nonBlankStringSchema,
} from './common-contracts.js';

export const textToJsonRequestSchema = z.strictObject({
  text: nonBlankStringSchema,
  schema: jsonObjectSchema,
});

export type TextToJsonRequest = z.infer<typeof textToJsonRequestSchema>;

export const textToJsonResponseSchema = z.looseObject({
  data: jsonObjectSchema,
});

export type TextToJsonResponse = z.infer<typeof textToJsonResponseSchema>;
