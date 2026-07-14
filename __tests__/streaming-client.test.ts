import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStreamingWebSocketUrl,
  parseStreamingTokenResponse,
} from '../streaming-client.js';

test('buildStreamingWebSocketUrl includes dictation and auth query params', () => {
  const url = buildStreamingWebSocketUrl({
    apiUrl: 'https://api.sully.ai/v1',
    sampleRate: 16000,
    encoding: 'linear32',
    dictation: true,
    language: 'en-US',
    accountId: 'acct_123',
    apiToken: 'token_456',
  });

  assert.equal(
    url,
    'wss://api.sully.ai/v1/audio/transcriptions/stream?sample_rate=16000&encoding=linear32&dictation=true&language=en-US&account_id=acct_123&api_token=token_456',
  );
});

test('buildStreamingWebSocketUrl omits optional params when absent', () => {
  const url = buildStreamingWebSocketUrl({
    apiUrl: 'http://localhost:4000/v1/',
    sampleRate: 16000,
    encoding: 'linear16',
    dictation: true,
  });

  assert.equal(
    url,
    'ws://localhost:4000/v1/audio/transcriptions/stream?sample_rate=16000&encoding=linear16&dictation=true',
  );
});

test('parseStreamingTokenResponse returns a validated token payload', () => {
  const token = parseStreamingTokenResponse({
    value: {
      token: 'token_123',
      apiUrl: 'https://api.sully.ai/v1',
      accountId: 'acct_123',
    },
  });

  assert.deepEqual(token, {
    token: 'token_123',
    apiUrl: 'https://api.sully.ai/v1',
    accountId: 'acct_123',
  });
});

test('parseStreamingTokenResponse rejects invalid payloads', () => {
  assert.throws(
    () =>
      parseStreamingTokenResponse({
        value: {
          token: 'token_123',
          apiUrl: 'https://api.sully.ai/v1',
        },
      }),
    /Invalid streaming token response/,
  );
});

test('parseStreamingTokenResponse rejects unapproved URLs and credential-shaped extras', () => {
  for (const value of [
    {
      token: 'token_123',
      apiUrl: 'https://attacker.example/v1',
      accountId: 'acct_123',
    },
    {
      token: 'token_123',
      apiUrl: 'https://api.sully.ai/v1',
      accountId: 'acct_123',
      apiKey: 'must-not-cross',
    },
  ]) {
    assert.throws(() => parseStreamingTokenResponse({ value }), /Invalid streaming token response/);
  }
});
