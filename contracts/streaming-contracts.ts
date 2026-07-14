import { z } from 'zod';

import { isApprovedSullyOrigin } from './sully-origin-contracts.js';

export const MIN_STREAMING_TOKEN_SECONDS = 60;
export const MAX_STREAMING_TOKEN_SECONDS = 604_800;

export const streamingTokenRequestSchema = z.strictObject({
  expiresIn: z
    .number()
    .int()
    .min(MIN_STREAMING_TOKEN_SECONDS)
    .max(MAX_STREAMING_TOKEN_SECONDS),
});

export const upstreamStreamingTokenSchema = z.looseObject({
  token: z.string().trim().min(1),
});

const streamingApiUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    /^\/v1\/?$/.test(url.pathname) &&
    isApprovedSullyOrigin(url)
  );
}, 'Streaming API URL must be an HTTP(S) v1 base URL');

export const streamingTokenBrokerResponseSchema = z.strictObject({
  token: z.string().trim().min(1),
  apiUrl: streamingApiUrlSchema,
  accountId: z.string().trim().min(1),
});

export type StreamingTokenRequest = z.infer<typeof streamingTokenRequestSchema>;
export type UpstreamStreamingToken = z.infer<typeof upstreamStreamingTokenSchema>;
export type StreamingTokenBrokerResponse = z.infer<typeof streamingTokenBrokerResponseSchema>;
