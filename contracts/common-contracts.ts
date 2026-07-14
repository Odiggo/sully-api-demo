import { z } from 'zod';

export const CREDENTIAL_NAMES = [
  'SULLY_API_URL',
  'SULLY_API_KEY',
  'SULLY_ACCOUNT_ID',
] as const;

export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

export interface TimerScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'Value must not be blank');

export const transcriptionIdSchema = z.string().regex(/^tr_[A-Za-z0-9]+$/);
export const noteIdSchema = z.string().regex(/^note_[A-Za-z0-9]+$/);
export const codingIdSchema = z.string().regex(/^coding_[A-Za-z0-9]+$/);
export const providerTimestampSchema = z.iso.datetime({ offset: true });

export const multipartBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const credentialNameSchema = z.enum(CREDENTIAL_NAMES);

export const healthResponseSchema = z
  .strictObject({
    ok: z.boolean(),
    missing: z.array(credentialNameSchema),
    invalid: z.array(credentialNameSchema),
  })
  .superRefine((value, context) => {
    const issueCount = value.missing.length + value.invalid.length;
    if (value.ok !== (issueCount === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Health readiness must match diagnostics',
      });
    }
  });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: nonBlankStringSchema,
    message: nonBlankStringSchema,
    requestId: nonBlankStringSchema,
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
