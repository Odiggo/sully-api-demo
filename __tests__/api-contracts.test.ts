import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SUPPORTED_LANGUAGES } from '../languages.js';
import {
  apiErrorSchema,
  codingCreateResponseSchema,
  codingIdSchema,
  codingRequestSchema,
  codingResponseSchema,
  healthResponseSchema,
  multipartBooleanSchema,
  noteCreateResponseSchema,
  noteIdSchema,
  noteRequestSchema,
  noteResponseSchema,
  streamingTokenBrokerResponseSchema,
  streamingTokenRequestSchema,
  textToJsonRequestSchema,
  textToJsonResponseSchema,
  transcriptionIdSchema,
  TRANSCRIPTION_LANGUAGES,
  transcriptionLanguageSchema,
  transcriptionResponseSchema,
  upstreamStreamingTokenSchema,
} from '../contracts/index.js';

const timestamp = '2024-01-15T10:30:00Z';

function assertRejects(schema: { safeParse(value: unknown): { success: boolean } }, values: unknown[]): void {
  for (const value of values) {
    assert.equal(schema.safeParse(value).success, false, `expected rejection: ${JSON.stringify(value)}`);
  }
}

describe('common local contracts', () => {
  test('validates IDs without path-shaped values', () => {
    assert.equal(transcriptionIdSchema.parse('tr_abc123'), 'tr_abc123');
    assert.equal(noteIdSchema.parse('note_ABC123'), 'note_ABC123');
    assert.equal(codingIdSchema.parse('coding_ABC123'), 'coding_ABC123');
    assertRejects(transcriptionIdSchema, ['', ' ', 'abc', 'tr_a/b', 'tr_a?x=1', null]);
    assertRejects(noteIdSchema, ['', 'note_', 'note_a/b', undefined]);
    assertRejects(codingIdSchema, ['', 'coding_', '../coding_a', 1]);
  });

  test('parses only exact multipart booleans', () => {
    assert.equal(multipartBooleanSchema.parse('true'), true);
    assert.equal(multipartBooleanSchema.parse('false'), false);
    assertRejects(multipartBooleanSchema, [undefined, '', ' ', 'TRUE', 'False', '0', '1', false]);
  });

  test('requires coherent diagnostic-only health', () => {
    assert.deepEqual(healthResponseSchema.parse({ ok: true, missing: [], invalid: [] }), {
      ok: true,
      missing: [],
      invalid: [],
    });
    assert.equal(
      healthResponseSchema.safeParse({ ok: true, missing: ['SULLY_API_KEY'], invalid: [] }).success,
      false,
    );
    assert.equal(healthResponseSchema.safeParse({ ok: false, missing: [], invalid: [] }).success, false);
    assert.equal(
      JSON.stringify(
        healthResponseSchema.parse({ ok: false, missing: ['SULLY_API_KEY'], invalid: [] }),
      ).includes('secret'),
      false,
    );
  });

  test('owns stable local error shape strictly', () => {
    const error = { error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: 'req_1' } };
    assert.deepEqual(apiErrorSchema.parse(error), error);
    assert.equal(apiErrorSchema.safeParse({ ...error, secret: 'no' }).success, false);
  });
});

describe('streaming token contracts', () => {
  test('accepts exact integer expiry boundaries and rejects malformed values', () => {
    assert.equal(streamingTokenRequestSchema.parse({ expiresIn: 60 }).expiresIn, 60);
    assert.equal(streamingTokenRequestSchema.parse({ expiresIn: 604_800 }).expiresIn, 604_800);
    assertRejects(streamingTokenRequestSchema, [
      {},
      { expiresIn: undefined },
      { expiresIn: '' },
      { expiresIn: '60' },
      { expiresIn: 59 },
      { expiresIn: 604_801 },
      { expiresIn: 60.5 },
      { expiresIn: Number.NaN },
      { expiresIn: 60, extra: true },
    ]);
  });

  test('separates documented upstream token from browser broker response', () => {
    assert.equal(upstreamStreamingTokenSchema.parse({ token: 'tok', future: true }).token, 'tok');
    assert.equal(upstreamStreamingTokenSchema.safeParse({ data: { token: 'tok' } }).success, false);
    assert.deepEqual(
      streamingTokenBrokerResponseSchema.parse({
        token: 'tok',
        apiUrl: 'https://api.sully.ai/v1',
        accountId: 'account',
      }),
      { token: 'tok', apiUrl: 'https://api.sully.ai/v1', accountId: 'account' },
    );
    assertRejects(streamingTokenBrokerResponseSchema, [
      { token: 'tok', apiUrl: 'javascript:alert(1)', accountId: 'account' },
      { token: 'tok', apiUrl: 'ftp://api.sully.ai/v1', accountId: 'account' },
      { token: 'tok', apiUrl: 'https://attacker.example/v1', accountId: 'account' },
      { token: 'tok', apiUrl: 'https://user:pass@api.sully.ai/v1', accountId: 'account' },
      { token: 'tok', apiUrl: 'https://api.sully.ai/v2', accountId: 'account' },
    ]);
    assert.equal(
      streamingTokenBrokerResponseSchema.safeParse({
        token: 'tok',
        apiUrl: 'https://api.sully.ai/v1',
        accountId: 'account',
        apiKey: 'secret',
      }).success,
      false,
    );
  });
});

describe('transcription contracts', () => {
  test('accepts documented upload languages and rejects unknown tags', () => {
    assert.equal(transcriptionLanguageSchema.parse('en-US'), 'en-US');
    assert.equal(TRANSCRIPTION_LANGUAGES.length, 89);
    for (const language of ['ar', 'ar-AE', 'ar-IR', 'bn', 'gu-IN', 'mr', 'ur']) {
      assert.equal(transcriptionLanguageSchema.parse(language), language);
    }
    assert.deepEqual(
      [...SUPPORTED_LANGUAGES.flatMap((language) => language.tags)].sort(),
      [...TRANSCRIPTION_LANGUAGES].sort(),
    );
    assertRejects(transcriptionLanguageSchema, ['', ' ', 'EN', 'multi', null]);
  });

  test('accepts pending, processing, completed, and failed provider states', () => {
    for (const status of ['pending', 'processing'] as const) {
      assert.equal(
        transcriptionResponseSchema.parse({
          data: { id: 'tr_abc123', status, created_at: timestamp, updated_at: timestamp },
        }).data.status,
        status,
      );
    }

    const completed = transcriptionResponseSchema.parse({
      data: {
        id: 'tr_abc123',
        status: 'completed',
        created_at: timestamp,
        updated_at: timestamp,
        result: {
          channels: [
            {
              transcript: 'Hello',
              confidence: 0.95,
              words: [{ word: 'Hello', start: 0, end: 0.5, confidence: 0.98, speaker: 0 }],
            },
          ],
        },
        future_field: 'accepted',
      },
      future_top_level: true,
    });
    assert.equal(completed.data.status, 'completed');
    assert.equal(completed.data.future_field, 'accepted');
    assert.equal(completed.future_top_level, true);

    assert.equal(
      transcriptionResponseSchema.parse({
        data: {
          id: 'tr_abc123',
          status: 'failed',
          result: { error: 'Processing failed' },
          created_at: timestamp,
          updated_at: timestamp,
        },
      }).data.status,
      'failed',
    );
  });

  test('rejects wrong terminal shapes, confidence, and word spans', () => {
    const completed = {
      data: {
        id: 'tr_abc123',
        status: 'completed',
        created_at: timestamp,
        updated_at: timestamp,
        result: { channels: [{ transcript: 'Hello', confidence: 0.95, words: [] }] },
      },
    };
    assert.equal(transcriptionResponseSchema.safeParse({ data: { ...completed.data, result: undefined } }).success, false);
    assert.equal(
      transcriptionResponseSchema.safeParse({
        data: {
          ...completed.data,
          result: { channels: [{ transcript: 'Hello', confidence: 1.1, words: [] }] },
        },
      }).success,
      false,
    );
    assert.equal(
      transcriptionResponseSchema.safeParse({
        data: {
          ...completed.data,
          result: {
            channels: [
              {
                transcript: 'Hello',
                confidence: 0.9,
                words: [{ word: 'Hello', start: 1, end: 0.5, confidence: 0.9 }],
              },
            ],
          },
        },
      }).success,
      false,
    );
  });
});

describe('note contracts', () => {
  const validRequest = {
    transcript: 'Patient reports a headache.',
    date: '2026-07-13',
    language: 'en',
    noteType: {
      type: 'note_style',
      template: 'Create a SOAP note.',
      includeJson: true,
    },
  } as const;

  test('accepts documented custom note request and rejects hostile local inputs', () => {
    assert.equal(noteRequestSchema.parse(validRequest).noteType.type, 'note_style');
    assert.equal(
      noteRequestSchema.parse({ ...validRequest, date: '2026-07-13T12:00:00Z' }).date,
      '2026-07-13T12:00:00Z',
    );
    assertRejects(noteRequestSchema, [
      {},
      { ...validRequest, transcript: null },
      { ...validRequest, transcript: '' },
      { ...validRequest, transcript: ' ' },
      { ...validRequest, date: '2026-02-30' },
      { ...validRequest, language: 'EN' },
      { ...validRequest, noteType: { ...validRequest.noteType, template: '' } },
      { ...validRequest, noteType: null },
      { ...validRequest, extra: true },
    ]);
  });

  test('accepts documented create and processing/done/error response shapes', () => {
    assert.equal(
      noteCreateResponseSchema.parse({
        status: 'ok',
        data: { noteId: 'note_ABC123', future: true },
        date: timestamp,
      }).data.noteId,
      'note_ABC123',
    );
    assert.equal(
      noteResponseSchema.parse({
        status: 'ok',
        data: { id: 'note_ABC123', status: 'STATUS_PROCESSING' },
        date: timestamp,
      }).data.status,
      'STATUS_PROCESSING',
    );

    for (const payload of [
      { markdown: '# Note' },
      { json: { soap: {} } },
      { markdown: '# Note', json: { soap: {} } },
    ]) {
      assert.equal(
        noteResponseSchema.parse({
          status: 'ok',
          data: { id: 'note_ABC123', status: 'STATUS_DONE', payload },
          date: timestamp,
          future: true,
        }).data.status,
        'STATUS_DONE',
      );
    }

    assert.equal(
      noteResponseSchema.parse({
        status: 'ok',
        data: { id: 'note_ABC123', status: 'STATUS_ERROR' },
        date: timestamp,
      }).data.status,
      'STATUS_ERROR',
    );
    assert.equal(
      noteResponseSchema.safeParse({
        status: 'ok',
        data: { id: 'note_ABC123', status: 'STATUS_DONE', payload: {} },
        date: timestamp,
      }).success,
      false,
    );
  });
});

describe('coding contracts', () => {
  test('owns request text strictly', () => {
    assert.deepEqual(codingRequestSchema.parse({ text: 'Clinical note' }), { text: 'Clinical note' });
    assertRejects(codingRequestSchema, [
      {},
      { text: null },
      { text: '' },
      { text: ' ' },
      { text: 1 },
      { text: 'x', extra: true },
    ]);
  });

  test('accepts lifecycle states plus string and numeric codes', () => {
    for (const status of ['pending', 'processing', 'failed'] as const) {
      assert.equal(
        codingResponseSchema.parse({
          data: { id: 'coding_ABC123', status, created_at: timestamp, updated_at: timestamp },
        }).data.status,
        status,
      );
    }

    const completed = codingResponseSchema.parse({
      data: {
        id: 'coding_ABC123',
        status: 'completed',
        created_at: timestamp,
        updated_at: timestamp,
        result: {
          diagnoses: [
            {
              id: 'diagnosis-1',
              code: {
                coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', display: 'Hypertension' }],
                text: 'Hypertension',
              },
              text_span: { start_char: 0, end_char: 12, text: 'Hypertension' },
            },
          ],
          procedures: [
            {
              id: 'procedure-1',
              code: {
                coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: 93000, display: 'ECG' }],
                text: 'ECG',
              },
              text_span: { start_char: 20, end_char: 23, text: 'ECG' },
            },
          ],
        },
        future: true,
      },
    });
    assert.equal(completed.data.status, 'completed');
  });

  test('separates create complete from retrieval completed states', () => {
    const created = {
      data: {
        id: 'coding_ABC123',
        status: 'complete',
        created_at: timestamp,
        updated_at: timestamp,
      },
    };
    assert.equal(codingCreateResponseSchema.parse(created).data.status, 'complete');
    assert.equal(codingResponseSchema.safeParse(created).success, false);
    assert.equal(
      codingCreateResponseSchema.safeParse({ ...created, data: { ...created.data, status: 'completed' } }).success,
      false,
    );
  });

  test('rejects completed response without result and reversed source spans', () => {
    assert.equal(
      codingResponseSchema.safeParse({
        data: { id: 'coding_ABC123', status: 'completed', created_at: timestamp, updated_at: timestamp },
      }).success,
      false,
    );
    assert.equal(
      codingResponseSchema.safeParse({
        data: {
          id: 'coding_ABC123',
          status: 'completed',
          created_at: timestamp,
          updated_at: timestamp,
          result: {
            diagnoses: [
              {
                id: 'diagnosis-1',
                code: { coding: [{ system: 'system', code: 'I10', display: 'Hypertension' }], text: 'Hypertension' },
                text_span: { start_char: 10, end_char: 2, text: 'bad' },
              },
            ],
            procedures: [],
          },
        },
      }).success,
      false,
    );
  });
});

describe('text-to-JSON contracts', () => {
  test('requires object-root JSON schema and strict request shape', () => {
    const request = { text: 'Patient is 45.', schema: { type: 'object', properties: {} } };
    assert.deepEqual(textToJsonRequestSchema.parse(request), request);
    assertRejects(textToJsonRequestSchema, [
      {},
      { ...request, text: '' },
      { ...request, text: ' ' },
      { ...request, text: null },
      { ...request, schema: [] },
      { ...request, schema: null },
      { ...request, extra: true },
    ]);
  });

  test('accepts arbitrary JSON object data and future provider fields', () => {
    assert.deepEqual(
      textToJsonResponseSchema.parse({ data: { age: 45, allergies: null }, future: true }).data,
      { age: 45, allergies: null },
    );
    assertRejects(textToJsonResponseSchema, [{ data: [] }, { data: null }, {}]);
  });
});
