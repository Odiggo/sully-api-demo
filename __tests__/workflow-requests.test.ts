import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodingRequest,
  buildNoteRequest,
  buildTextToJsonRequest,
  buildTranscriptionFormData,
  formatCodingResult,
  transcriptText,
} from '../browser/workflows/workflow-data.js';

test('builds exact transcription multipart fields', () => {
  const file = new File(['RIFF'], 'patient-name.wav', { type: 'audio/wav' });
  const data = buildTranscriptionFormData({
    file,
    language: 'en-US',
    dictation: false,
    multichannel: true,
  });
  assert.equal(data.get('audio'), file);
  assert.equal(data.get('language'), 'en-US');
  assert.equal(data.get('dictation'), 'false');
  assert.equal(data.get('multichannel'), 'true');
});

test('builds exact requests for all stable note modes', () => {
  const common = { transcript: 'Exact transcript', date: '2026-07-13', language: 'en' };
  const structuredTemplate = {
    id: 'soap-template',
    title: 'SOAP note',
    sections: [{ type: 'heading', title: 'Assessment' }],
  };
  assert.deepEqual(buildNoteRequest({ ...common, noteType: { type: 'soap' } }), {
    ...common,
    noteType: { type: 'soap' },
  });
  assert.deepEqual(
    buildNoteRequest({
      ...common,
      noteType: { type: 'note_style', template: 'SOAP', includeJson: true },
    }),
    { ...common, noteType: { type: 'note_style', template: 'SOAP', includeJson: true } },
  );
  assert.deepEqual(
    buildNoteRequest({
      ...common,
      noteType: { type: 'note_template', templateText: JSON.stringify(structuredTemplate) },
    }),
    { ...common, noteType: { type: 'note_template', template: structuredTemplate } },
  );
});

test('rejects malformed or incomplete structured note templates locally', () => {
  const common = { transcript: 'Exact transcript', date: '2026-07-13', language: 'en' };
  assert.throws(
    () => buildNoteRequest({ ...common, noteType: { type: 'note_template', templateText: '{' } }),
    /valid JSON object/i,
  );
  assert.throws(
    () =>
      buildNoteRequest({
        ...common,
        noteType: { type: 'note_template', templateText: '{"id":"id","title":"Title"}' },
      }),
    /id, title, and at least one section/i,
  );
});

test('rejects invalid text-to-JSON schema before network input exists', () => {
  assert.throws(
    () => buildTextToJsonRequest({ text: 'age 42', schemaText: '{' }),
    /valid JSON object/i,
  );
  assert.throws(
    () => buildTextToJsonRequest({ text: 'age 42', schemaText: '[]' }),
    /valid JSON object/i,
  );
  assert.deepEqual(
    buildTextToJsonRequest({ text: 'age 42', schemaText: '{"age":"number"}' }),
    { text: 'age 42', schema: { age: 'number' } },
  );
});

test('preserves coding input and formats string/numeric code evidence', () => {
  assert.deepEqual(buildCodingRequest('Finding'), { text: 'Finding' });
  const formatted = formatCodingResult({
    diagnoses: [
      {
        id: 'd1',
        code: { coding: [{ system: 'ICD-10', code: 'J45.909', display: 'Asthma' }], text: 'Asthma' },
        text_span: { start_char: 0, end_char: 6, text: 'asthma' },
      },
    ],
    procedures: [
      {
        id: 'p1',
        code: { coding: [{ system: 'CPT', code: 99213, display: 'Office visit' }], text: 'Visit' },
        text_span: { start_char: 8, end_char: 13, text: 'visit' },
      },
    ],
  });
  assert.match(formatted, /J45\.909/);
  assert.match(formatted, /99213/);
  assert.match(formatted, /asthma/);
});

test('joins only nonblank completed transcript channels', () => {
  assert.equal(
    transcriptText({ channels: [{ transcript: 'First', confidence: 0.9 }, { transcript: '  ', confidence: 0.8 }, { transcript: 'Second', confidence: 0.95 }] }),
    'First\n\nSecond',
  );
});
